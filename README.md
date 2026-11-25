# Gratis Readest

Gratis Readest 是一个基于 [Readest 上游项目](https://github.com/readest/readest) 的社区维护版本。

## 项目调整

- 保留原版登录能力。
- WebDAV、S3、Google Drive 和 OneDrive 不要求 Readest 账号或 Premium。
- 默认隐藏 Integrations 页面中的 Readest Cloud 入口；登录页仍保留明确的启用选项，选择后可使用 Readest Cloud 同步。
- 关闭 telemetry。
- 使用独立的 `GratisReadest` 本地数据目录。
- 保持远程同步目录与上游兼容。

## 下载

- 稳定版：查看本项目的 [GitHub Releases](https://github.com/Moranjianghe/gratis-readest/releases)。
- 每夜测试版：查看 [GitHub Actions Artifacts](https://github.com/Moranjianghe/gratis-readest/actions/workflows/nightly.yml)。

## 开发

构建和分支同步说明见：

- [AI 交接文档](docs/ai-handoff/README.md)
- [分支同步流程](docs/branch-sync.md)
- [上游贡献指南](CONTRIBUTING.md)

本项目采用 [AGPL-3.0](LICENSE) 许可证。
