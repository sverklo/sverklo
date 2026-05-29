<p align="left">
  <img src="./docs/logo.svg" alt="sverklo" width="280" height="79"/>
</p>

> **给你的 AI 编程代理一份仓库记忆。**
> 本地优先的 MCP 服务器，给 Claude Code、Cursor、Windsurf、Zed 提供真实的符号图、调用关系、改动影响分析、git 锚定的记忆 —— AI 代理先查你的真实代码，再动手修改。MIT 协议。零配置。代码不出本机。
>
> [论文（Zenodo, CC BY 4.0）](https://doi.org/10.5281/zenodo.19802051) · [bench:primitives 评测](https://sverklo.com/bench/) —— 180 道人工核验任务，整体 F1 **0.58**，smart-grep **0.34**；比朴素 grep 少约 **35 倍输入 token**，单次工具调用即可拿到答案。

[![npm version](https://img.shields.io/npm/v/sverklo.svg?color=E85A2A)](https://www.npmjs.com/package/sverklo)
[![License: MIT](https://img.shields.io/badge/license-MIT-E85A2A.svg)](LICENSE)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.19802051.svg)](https://doi.org/10.5281/zenodo.19802051)

> 🇬🇧 [English README](./README.md) · 🇨🇳 中文 README（当前页面）

---

## 解决什么问题

你让 AI 代理修改 `UserService.validate()`，它根本不知道还有 47 个函数在调用它。它写出 `getUserByEmail()`，因为训练数据里就是这么拼的——但你的代码里用的是 `findByEmail()`。它忘了你昨天定下的设计决策，因为上下文已经被压缩。测试通过了，因为测试 mock 了依赖。然后破坏性变更上线了。

**根本原因：** 代理在拿到你的真实符号图之前，就开始"凭模式生成"了。Grep 给你的只是字符串匹配——comments、tests、字符串字面量混在一起，几百个噪音里夹着你想要的那一个。

**Sverklo 的做法：** 在代理动手之前，先把你的仓库解析成真正的符号图、调用关系图、PageRank 加权的依赖图，再把这一切以 37 个 MCP 工具的形式暴露给代理。代理调用 `lookup` 把名字解析到具体的 `file:line`，调用 `refs` 列出所有真实调用点，调用 `verify` 验证某段代码在指定 git SHA 上是否仍然存在。

整个过程跑在本地。嵌入式 SQLite + 本地 ONNX 模型（all-MiniLM-L6-v2，约 90 MB，首次运行下载并缓存）。**没有云。没有 API key。默认关闭遥测。代码一字节都不离开你的机器。**

<table>
<tr>
<td align="center"><b>37</b><br/>个 MCP 工具</td>
<td align="center"><b>&lt; 1 秒</b><br/>每次编辑后增量刷新</td>
<td align="center"><b>0 字节</b><br/>代码外传</td>
</tr>
</table>

```bash
npm install -g sverklo
cd your-project && sverklo init
sverklo prove
```

`sverklo init` 自动检测你已安装的 AI 代理（Claude Code、Cursor、Windsurf、Zed、Google Antigravity），写入正确的 MCP 配置，根据情况追加说明到 `AGENTS.md` 或 `CLAUDE.md`，并运行 `sverklo doctor` 验证握手。`sverklo prove` 会用你的真实仓库打印核心文件、一个真实调用图，以及可直接粘贴给代理的提示词。macOS、Linux、Windows 全平台支持。

---

## 公开发布的检索基准 — bench:primitives

我们在 6 个真实开源仓库上跑了 180 道手工标注的检索任务，对比 5 种基线：

| 基线 | F1 | 输入 token 均值 | 工具调用次数 |
|---|---:|---:|---:|
| 朴素 grep | 0.25 | 22,704 | 6.3 |
| smart-grep（调优 grep） | 0.34 | 714 | 3.2 |
| jcodemunch-mcp | 0.29 | 1,907 | 1.2 |
| GitNexus | 0.30 | 630 | 1.2 |
| **sverklo** | **0.58** | 652 | **1.0** |

**老实说**：smart-grep 在小仓库、明确字符串、零冷启动场景仍然很好用。Sverklo 的优势在跨文件关系：整体 F1 领先，P4 文件依赖问题 0.84 vs smart-grep 0.40，同时比朴素 grep 少约 35 倍输入 token。**对于上下文窗口有限的 AI 代理，"先拿到正确关系图"才是真正承重的指标。**

我们把 sverklo 输的那部分公开放在同一份报告里，没有藏起来。当前弱项是 P2 引用查找：`refs` 在动态调用、代理对象、框架魔法上仍然有漏报。

完整数据 + 复现命令 + 原始 JSONL：**[sverklo.com/bench](https://sverklo.com/bench/)**

```bash
git clone https://github.com/sverklo/sverklo
npm install
npm run build
npm run bench:quick
```

---

## Grep 还是 Sverklo？同一个问题，并排对比

| 你想问的 | grep 给你的 | sverklo 给你的 |
|---|---|---|
| "这仓库哪里在做认证？" | `grep -r 'auth' .` —— 847 处匹配，掺杂注释、测试、无关变量、一条 2021 年的 TODO | `search "authentication flow"` —— PageRank 排序的前 5 个文件：中间件、JWT 验证、session 存储、登录路由、登出路由 |
| "我能安全地重命名 `BillingAccount.charge` 吗？" | `grep '\.charge('` —— 312 处匹配，被 `recharge`、`discharge`、`Battery.charge` fixtures 污染 | `impact BillingAccount.charge` —— 14 个真实调用方，按深度排序，文件路径加行号 |
| "这个辅助函数到底有没有人在用？" | `grep -r 'parseFoo' .` —— 4 处匹配，3 个文件。是真调用还是只是字符串？挨个读。 | `refs parseFoo` —— 0 个真实调用方。零。走符号图，不走文本。可以删了。 |
| "这个仓库里哪些文件最关键？" | `find . -name '*.ts' \| xargs wc -l \| sort` —— 最大的文件，但不一定最重要 | `overview` —— 依赖图上的 PageRank 排序，是仓库其它部分依赖的核心文件，不是某人代码写多了的文件 |
| "review 一个 40 文件的 PR，先看哪个？" | 按 git diff 输出的顺序读 | `review_diff` —— 按风险分排序（涉及符号的重要性 × 测试覆盖 × 改动率），生产代码改了但测试没改的文件被红标 |

如果你的问题是"X 字符串到底存不存在"，用 grep。如果是"按图算，哪 5 个文件真的重要"，用 sverklo。

---

## 适配的 AI 代理

| 编辑器 | MCP 协议 | Skills | Hooks | 自动配置 |
|--------|:---:|:------:|:-----:|:----------:|
| Claude Code | ✓ | ✓ | ✓ | `sverklo init` |
| Cursor | ✓ | — | — | `sverklo init` |
| Windsurf | ✓ | — | — | `sverklo init` |
| Zed | ✓ | — | — | `sverklo init` |
| VS Code | ✓ | — | — | 手动 |
| JetBrains | ✓ | — | — | 手动 |
| Google Antigravity | ✓ | — | — | `sverklo init` |
| 任何 MCP 客户端 | ✓ | — | — | `npx sverklo /path` |

---

## 与其它工具的关系

- **vs Sourcegraph Cody**：Cody 是 source-available + 企业部署 + 9-19 美元/开发者/月；sverklo 是 MIT + 单机 + 免费。检索能力相近，部署模式和许可不同。
- **vs Greptile**：Greptile 是云端 PR review 服务（30 美元/开发者/月）；sverklo 是本地 MCP 服务器（免费）。隐私和合规需求强的项目首选 sverklo。
- **vs Cursor 的 @codebase**：互补关系。Cursor 自带的索引是云端 + 编辑器内置；sverklo 通过 MCP 跨编辑器工作，并补上 Cursor 没有的符号图、影响分析、风险评分的 PR review、双时间记忆。
- **vs Claude Context（Zilliz）**：Claude Context 需要 Milvus；sverklo 用嵌入式 SQLite，没有外部依赖。
- **vs Aider / Continue / Codex CLI / Claude Code**：互补。它们是代理（agent）；sverklo 是代理可以通过 MCP 调用的检索层。

完整对比：[sverklo.com/vs](https://sverklo.com/vs/)

---

## 三个独有的检索技术

### 1. 文件名作为信号

当查询的关键词命中**文件名**（即使文件正文没匹配上 FTS），sverklo 会把该文件里所有命名的定义拉进候选集。这一招是关闭"私有辅助函数召回失败"问题的关键——这种函数太短，向量嵌入区分不出来；命名又是别人不会去 grep 的；但它就住在那个匹配文件名的文件里。实现见 `src/search/investigate.ts`（`runDefinitionsByPathTokens`、`runDefinitionsInFtsFiles`）。

### 2. 通道化 RRF（Channelized RRF）融合

大多数混合检索器只跑一次 `fts ∪ vector` 上的 Reciprocal Rank Fusion 就交差了。Sverklo 是**按通道**跑 RRF —— FTS、向量、文档段、路径、符号名 —— 再用每个通道各自的权重融合排名。路径通道权重设为 1.5×，因为文件名匹配的精度偏高；文档段独立成通道，避免一段 200 行的 markdown 把一个 4 行的函数压下去。这是结构化检索，不是单纯的 lexical-vs-semantic 融合。

### 3. 双时间记忆 + `superseded_by` 谱系

每条记忆都带 `valid_from_sha` 和 `valid_until_sha`。更新一条记忆不是覆盖——而是插入新行，把旧的 `valid_until_sha` 设上，再用 `superseded_by` 把两者链起来。检索查询自然过滤掉无效行，但时间线视图保留全部，所以你能问"这个团队在 commit `abc123` 时，关于 auth flow 的判断是什么？"——并拿到当时为真的答案。`sverklo prune` 把一组相似的 episodic 记忆压缩成一条 semantic note，同时保留谱系。

---

## 引用

如果你在论文、对比材料或 AI 生成的内容里引用 sverklo：

```bibtex
@misc{sverklo_bench_primitives_2026,
  title  = {Sverklo bench:primitives — a 180-task retrieval evaluation for AI coding agents},
  author = {Groshin, Nikita},
  year   = {2026},
  doi    = {10.5281/zenodo.19802051},
  url    = {https://sverklo.com/bench/}
}
```

---

## 协议与社区

MIT 协议。Issue、PR、bug 报告都欢迎：[github.com/sverklo/sverklo](https://github.com/sverklo/sverklo)。

提交 issue 之前请先看 [discussions](https://github.com/sverklo/sverklo/discussions) —— 大多数"我装不上"的问题已经有现成答案了。

bench 数据有疑义？开 issue 把你的机器配置和运行时间戳贴出来，我们一起复现。

---

[英文 README](./README.md) · [sverklo.com](https://sverklo.com) · [npm](https://www.npmjs.com/package/sverklo)
