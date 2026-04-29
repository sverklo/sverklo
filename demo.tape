# Sverklo Demo — health audit on any codebase
Output docs/demo.gif
Set FontSize 14
Set Width 1000
Set Height 720
Set Theme "Dracula"
Set Padding 18
Set TypingSpeed 32ms
Set Shell "zsh"

# vhs runs zsh non-interactively, where `#` is literal by default.
# Turn on interactive_comments so the demo's narration lines render
# as comments instead of "command not found" errors.
Hide
Type "setopt interactive_comments"
Enter
Type "cd ~/projects/research/product/sverklo"
Enter
Type "clear"
Enter
Sleep 400ms
Show

Type "# Health audit, any codebase, zero config"
Enter
Sleep 800ms

Type "sverklo audit"
Enter
Sleep 8s

Type "# Add the grade as a README badge"
Enter
Sleep 700ms

Type "sverklo audit --badge"
Enter
Sleep 4s

Sleep 1500ms
