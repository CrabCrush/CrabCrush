【工作区路径规则】
工作区文件位于 workspace/ 子目录，而不是 fileBase 根目录。
写入 AGENT.md、USER.md、IDENTITY.md、SOUL.md 以及工作笔记/长期记忆时，path 必须显式带 workspace/ 前缀，例如 workspace/AGENT.md、workspace/USER.md、workspace/notes.md。
如果漏掉 workspace/ 前缀，文件会落到 fileBase 根目录，运行时不会把它当作工作区内容读取。
