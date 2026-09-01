# 数据源适配器 v1

当前决策引擎保持冻结。数据适配器只负责提供行情证据，不得生成或修改周期、偏好、评分、候选、权限和仓位。

每个适配器必须声明：

- `contractVersion: 1`
- 稳定的 `id`、`label`、`kind` 和 `priority`
- 支持的 `capabilities`
- `executionAuthority: false`
- `invoke(capability, ...args)`

注册表按优先级逐项调用。用户数据源失败、返回错交易日、错复权口径或夹带决策权限字段时，该项会被拒绝并继续尝试免费保底源。回退过程必须保留实际来源和失败原因。

`free-fallback` 第一版仅代理项目现有的东方财富、同花顺、腾讯及本机同日缓存逻辑，不改变任何决策算法。免费源属于尽力而为能力，不承诺连续可用。

## 本地用户数据源

桌面运行目录下使用：

```text
data/provider-config.json
data/providers/<module>.cjs
```

配置只保存模块文件名、优先级和环境变量名称。Token、密码和Cookie禁止写入配置文件，凭据必须由本机环境变量提供。模块路径被限制在运行目录的 `data/providers` 内，防止配置静默加载任意外部脚本。

示例见 `provider-config.example.json`。未配置、模块缺失或用户源调用失败时，系统继续使用免费保底源，并保留失败原因。
