# 时区、真太阳时与占星计算：单独集成说明

- `src/timezone.ts` / `src/astrology_adapter.ts` 可在 Node ≥20 ESM TypeScript 项目中导入；依赖为 `@js-temporal/polyfill@0.5.1` 和 `astronomy-engine@2.1.19`。安装结束后计算与测试完全离线；无外部 API 或地址地理编码。历史 IANA 数据来自运行环境 ICU，固定算例验证于 Node 24.22.3 / tzdb 2026e；不承诺不同旧版 tzdb 完全相同。
- 支持 1900–2100 的公历钟点。转换接受明确 IANA 区名或 `UTC`；夏令时重叠返回两个带偏移候选，需显式较早／较晚；跳时或跳日不能前后挪动当成功。
- `trueSolarTime` 用地心太阳真赤经配格林尼治视恒星时，还原真太阳时角，再按标记的东经修正。输出 `solar_local` 是无时区钟面字段：不能加 `Z`、不能再按同一区时换回、不能直接喂给星座计算。未接高精度 UT1 或地方视差校正，不保证在临界秒级唯一。经度须显式提供，不推断私人出生地。
- Bazi 的民用时间与真太阳时是单独可选约定；星座使用由民用钟点解析的真实 UTC 瞬间，不使用真太阳时钟面；对应规则必须各自注明。
- 占星实现热带黄道地心太阳；`planetary` 再给月球与水星至冥王星地心黄经。不提供上升、宫位、相位或恒星黄道。不给缺时或模糊时间补中午：只传日期即可查看全日候选；未给 IANA 时区用 UTC−12…UTC+14 覆盖范围。传入明确钟点时，缺秒视作输入点的 0 秒；这不适用于“约几点”或只记得时辰的输入。精确点近换座的结果是库算法点估计。
- 结果保留输入分支、规则版本，不从任何天文标签推断心理状况。

## 独立依据与测试
- 公开数据：[IANA 亚洲规则](https://data.iana.org/time-zones/tzdb/asia)、[美国海军天文台 2024 四季事件](https://aa.usno.navy.mil/calculated/seasons?dst=false&submit=Get+Data&tz=0&tz_label=true&tz_sign=0&year=2024)、[真太阳时定义](https://aa.usno.navy.mil/faq/eqtime)与[太阳时差独立近似算法](https://aa.usno.navy.mil/faq/sun_approx)。
- 软件 API：[Temporal polyfill](https://github.com/js-temporal/temporal-polyfill)、[Astronomy Engine JS](https://github.com/cosinekitty/astronomy/tree/master/source/js)。
- 运行 `npm ci --ignore-scripts` 后 `npm test`（不可写环境可加 `--cache /tmp/thoughts-npm-cache`）。只复制 src/test 文件与依赖声明，不复制测试缓存或 node_modules。
- 地心黄经另与 [Swiss Ephemeris Python binding](https://pypi.org/project/pyswisseph/2.10.3.2/) 的 Moshier 模式在三个虚构时刻交叉检查：1910、2024、2095 各一，10 天体均在 0.03° 测试容差内（不外推为全时段误差界）。该独立核对工具不随包交付，也不是运行和测试依赖。
