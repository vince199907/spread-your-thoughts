import { civilToUtc, trueSolarTime, validateZone, YEAR_MIN, YEAR_MAX, TimeInputError } from "./timezone.js";
import { fail, ok, type Result } from "./result.js";
import { Lunar, LunarMonth, LunarUtil, LunarYear, Solar, engineVersion } from "./lunar.js";

export const RULE_VERSION = "bazi-pillars-v1";

const JIE = new Set([
  "立春",
  "惊蛰",
  "清明",
  "立夏",
  "芒种",
  "小暑",
  "立秋",
  "白露",
  "寒露",
  "立冬",
  "大雪",
  "小寒",
]);

const ELEMENTS = ["木", "火", "土", "金", "水"] as const;
type ElementName = (typeof ELEMENTS)[number];
type ElementCounts = Record<ElementName, number>;

export interface Clock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface BaziInput {
  calendar: "solar" | "lunar";
  year: number;
  month: number;
  day: number;
  hour: number | null;
  minute: number;
  second: number;
  leap: boolean | null;
  sect: 1 | 2;
  gender: "female" | "male" | "unspecified" | null;
}

interface Pillar {
  ganZhi: string;
  gan: string;
  zhi: string;
  wuXing: string;
  hideGan: string[];
}

interface TenGods {
  dayMasterStem: string;
  stems: { year: string; month: string; day: string; hour: string | null };
  branches: {
    year: string[];
    month: string[];
    day: string[];
    hour: string[] | null;
  };
}

interface Slot<T> {
  status: "known" | "unknown" | "ambiguous";
  value: T | null;
  candidates?: { label: string; value: T }[];
  reason?: string;
}

interface Core {
  label: string;
  year: Pillar;
  month: Pillar;
  day: Pillar;
  ten: Omit<TenGods, "stems" | "branches"> & {
    stems: { year: string; month: string; day: string };
    branches: { year: string[]; month: string[]; day: string[] };
  };
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isGregorianDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const dim = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const max = month === 2 && leap ? 29 : dim[month];
  return day <= max;
}

function emptyCounts(): ElementCounts {
  return { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
}

function addLabels(counts: ElementCounts, text: string): void {
  for (const ch of text) {
    if (!ELEMENTS.includes(ch as ElementName)) {
      throw new Error(`库返回了无法识别的五行字：${ch}`);
    }
    counts[ch as ElementName] += 1;
  }
}

function stemElement(stem: string): string {
  const mapped = LunarUtil.WU_XING_GAN[stem];
  if (!mapped || mapped.startsWith("{")) {
    throw new Error(`LunarUtil.WU_XING_GAN 没有天干 ${stem}`);
  }
  return mapped;
}

export function addMinutes(parts: Clock, delta: number): Clock {
  const dt = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
  );
  dt.setUTCMinutes(dt.getUTCMinutes() + delta);
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
    hour: dt.getUTCHours(),
    minute: dt.getUTCMinutes(),
    second: dt.getUTCSeconds(),
  };
}

function pillarFrom(
  ganZhi: string,
  gan: string,
  zhi: string,
  wuXing: string,
  hideGan: string[],
): Pillar {
  return { ganZhi, gan, zhi, wuXing, hideGan: [...hideGan] };
}

function readCore(at: Clock, sect: 1 | 2, label: string): Core {
  const ec = Solar.fromYmdHms(at.year, at.month, at.day, at.hour, at.minute, at.second)
    .getLunar()
    .getEightChar();
  ec.setSect(sect);
  return {
    label,
    year: pillarFrom(ec.getYear(), ec.getYearGan(), ec.getYearZhi(), ec.getYearWuXing(), ec.getYearHideGan()),
    month: pillarFrom(
      ec.getMonth(),
      ec.getMonthGan(),
      ec.getMonthZhi(),
      ec.getMonthWuXing(),
      ec.getMonthHideGan(),
    ),
    day: pillarFrom(ec.getDay(), ec.getDayGan(), ec.getDayZhi(), ec.getDayWuXing(), ec.getDayHideGan()),
    ten: {
      dayMasterStem: ec.getDayGan(),
      stems: {
        year: ec.getYearShiShenGan(),
        month: ec.getMonthShiShenGan(),
        day: ec.getDayShiShenGan(),
      },
      branches: {
        year: [...ec.getYearShiShenZhi()],
        month: [...ec.getMonthShiShenZhi()],
        day: [...ec.getDayShiShenZhi()],
      },
    },
  };
}

function readHour(at: Clock, sect: 1 | 2): { pillar: Pillar; shiShenGan: string; shiShenZhi: string[] } {
  const ec = Solar.fromYmdHms(at.year, at.month, at.day, at.hour, at.minute, at.second)
    .getLunar()
    .getEightChar();
  ec.setSect(sect);
  return {
    pillar: pillarFrom(ec.getTime(), ec.getTimeGan(), ec.getTimeZhi(), ec.getTimeWuXing(), ec.getTimeHideGan()),
    shiShenGan: ec.getTimeShiShenGan(),
    shiShenZhi: [...ec.getTimeShiShenZhi()],
  };
}

interface JieHit {
  name: string;
  hour: number;
  minute: number;
  second: number;
}

function jieOnCivilDate(year: number, month: number, day: number): JieHit | "multiple" | null {
  const table = Solar.fromYmdHms(year, month, day, 12, 0, 0).getLunar().getJieQiTable();
  const hits: JieHit[] = [];
  for (const [name, solar] of Object.entries(table)) {
    if (!JIE.has(name)) continue;
    if (solar.getYear() === year && solar.getMonth() === month && solar.getDay() === day) {
      hits.push({
        name,
        hour: solar.getHour(),
        minute: solar.getMinute(),
        second: solar.getSecond(),
      });
    }
  }
  if (hits.length > 1) return "multiple";
  return hits[0] ?? null;
}

function mergeSlot(items: { label: string; value: Pillar }[]): Slot<Pillar> {
  const unique = new Map<string, { label: string; value: Pillar }>();
  for (const item of items) {
    if (!unique.has(item.value.ganZhi)) unique.set(item.value.ganZhi, item);
  }
  if (unique.size === 1) {
    return { status: "known", value: [...unique.values()][0].value };
  }
  return {
    status: "ambiguous",
    value: null,
    candidates: [...unique.values()],
    reason: `未知时辰，这些读数的干支不一致：${[...unique.values()].map((item) => `${item.label}=${item.value.ganZhi}`).join("、")}。不选取其中一条当作确定结果。`,
  };
}

function countSurface(pillars: Pillar[]): ElementCounts {
  const counts = emptyCounts();
  for (const pillar of pillars) addLabels(counts, pillar.wuXing);
  return counts;
}

function countHidden(pillars: Pillar[]): ElementCounts {
  const counts = emptyCounts();
  for (const pillar of pillars) {
    for (const stem of pillar.hideGan) addLabels(counts, stemElement(stem));
  }
  return counts;
}

function lunarMonthSigned(input: BaziInput): number {
  return input.leap ? -input.month : input.month;
}

export function parseBaziInput(raw: unknown): Result<BaziInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("INVALID_INPUT", "出生信息必须是 JSON 对象。");
  }
  const obj = raw as Record<string, unknown>;
  const calendar = obj.calendar;
  if (calendar !== "solar" && calendar !== "lunar") {
    return fail("INVALID_CALENDAR", "calendar 只能是 solar（公历）或 lunar（农历）。");
  }
  if (!isInt(obj.year) || !isInt(obj.month) || !isInt(obj.day)) {
    return fail("INVALID_DATE", "year、month、day 必须是整数。");
  }
  if (obj.month < 1 || obj.month > 12) {
    return fail("INVALID_DATE", "月份必须在 1 到 12 之间。");
  }
  let hour: number | null;
  if (obj.hour === null || obj.hour === "unknown") {
    hour = null;
  } else if (isInt(obj.hour) && obj.hour >= 0 && obj.hour <= 23) {
    hour = obj.hour;
  } else {
    return fail("INVALID_HOUR", "hour 必须是 0–23 的整数、null 或 \"unknown\"。不接受时辰名，也不把未知时辰填成午时。");
  }
  const minute = obj.minute === undefined ? 0 : obj.minute;
  const second = obj.second === undefined ? 0 : obj.second;
  if (!isInt(minute) || minute < 0 || minute > 59 || !isInt(second) || second < 0 || second > 59) {
    return fail("INVALID_TIME", "minute 与 second 必须是 0–59 的整数。");
  }
  if (hour === null && (obj.minute !== undefined || obj.second !== undefined)) {
    return fail("MINUTE_WITHOUT_HOUR", "时辰未知时不能同时给出分钟或秒。");
  }
  let leap: boolean | null = null;
  if (calendar === "lunar") {
    if (obj.leap === undefined) leap = null;
    else if (typeof obj.leap === "boolean") leap = obj.leap;
    else return fail("INVALID_LEAP", "农历 leap 必须是布尔值；该年若有同号闰月，必须显式写出 true 或 false。");
  } else if (obj.leap !== undefined) {
    return fail("INVALID_LEAP", "公历输入不使用 leap。");
  }
  let sect: 1 | 2 = 2;
  if (obj.sect !== undefined) {
    if (obj.sect !== 1 && obj.sect !== 2) return fail("INVALID_SECT", "sect 只能是 1 或 2。");
    sect = obj.sect;
  }
  let gender: BaziInput["gender"] = null;
  if (obj.gender !== undefined && obj.gender !== null) {
    if (obj.gender !== "female" && obj.gender !== "male" && obj.gender !== "unspecified") {
      return fail("INVALID_GENDER", "gender 只能是 female、male、unspecified 或省略。它不参与排盘。");
    }
    gender = obj.gender;
  }
  if (calendar === "solar" && !isGregorianDate(obj.year, obj.month, obj.day)) {
    return fail("INVALID_DATE", "这不是有效的公历日期。程序在调用历法库之前拒绝它，避免库把非法日期排成盘。");
  }
  return ok({
    calendar,
    year: obj.year,
    month: obj.month,
    day: obj.day,
    hour,
    minute,
    second,
    leap,
    sect,
    gender,
  });
}

function validateLunar(input: BaziInput): Result<{ monthSigned: number }> {
  let leapMonth = 0;
  try {
    leapMonth = LunarYear.fromYear(input.year).getLeapMonth();
  } catch (error) {
    return fail("ENGINE_FAILED", `农历年无法读取：${error instanceof Error ? error.message : String(error)}`);
  }
  if (input.leap === true) {
    if (leapMonth === 0) {
      return fail("NO_LEAP_MONTH", `农历${input.year}年没有闰月。`);
    }
    if (input.month !== leapMonth) {
      return fail("LEAP_MONTH_MISMATCH", `农历${input.year}年的闰月是${leapMonth}月，不是${input.month}月。`);
    }
  } else if (input.leap === null && leapMonth === input.month) {
    return fail(
      "LEAP_FLAG_REQUIRED",
      `农历${input.year}年有闰${leapMonth}月。这个月序必须显式给出 leap true 或 false，不能默认成非闰月。`,
    );
  }
  const monthSigned = input.leap ? -input.month : input.month;
  let monthInfo;
  try {
    monthInfo = LunarMonth.fromYm(input.year, monthSigned);
  } catch (error) {
    return fail("INVALID_LUNAR_DATE", `农历月份无效：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!monthInfo) return fail("INVALID_LUNAR_DATE", "农历月份无效。");
  if (input.day < 1 || input.day > monthInfo.getDayCount()) {
    return fail(
      "INVALID_LUNAR_DATE",
      `该农历月只有 ${monthInfo.getDayCount()} 天，不能使用第 ${input.day} 天。`,
    );
  }
  return ok({ monthSigned });
}

function solarFromInput(input: BaziInput, atHour: number, minute: number, second: number): Result<Clock> {
  try {
    if (input.calendar === "solar") {
      return ok({
        year: input.year,
        month: input.month,
        day: input.day,
        hour: atHour,
        minute,
        second,
      });
    }
    const lunar = Lunar.fromYmdHms(input.year, lunarMonthSigned(input), input.day, atHour, minute, second);
    const solar = lunar.getSolar();
    return ok({
      year: solar.getYear(),
      month: solar.getMonth(),
      day: solar.getDay(),
      hour: solar.getHour(),
      minute: solar.getMinute(),
      second: solar.getSecond(),
    });
  } catch (error) {
    return fail("ENGINE_FAILED", `历法换算失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function provenance(input: BaziInput, extra: Record<string, unknown>) {
  return {
    engine: "lunar-javascript",
    engineVersion: engineVersion(),
    license: "MIT",
    ruleVersion: RULE_VERSION,
    sect: input.sect,
    sectNote:
      input.sect === 1
        ? "流派1：晚子时（23:00–23:59）日柱算次日。两种流派的晚子时时柱都按次日日干起时干。本程序在时辰未知时不输出时柱。"
        : "流派2（lunar-javascript 默认，本程序也默认显式传入 2）：晚子时日柱仍算当天。时辰未知因此不拆开日柱，但时柱仍然未知，不会填成午时或子时。",
    timezoneConversion: "none",
    trueSolarTime: false,
    timeStandard:
      "输入的年月日时分秒是钟面数字，本程序不做 IANA 时区换算，也不做经度真太阳时修正。节气交接时刻来自 lunar-javascript 的历表，按其常规含义是东八区钟面。若出生钟面不是东八区，请先自行换算再输入。",
    genderUsedInCalculation: false,
    elementCountsArePersonalityMeasures: false,
    noonSubstitution: false,
    ...extra,
  };
}

function computeLegacyBazi(raw: unknown): Result<Record<string, unknown>> {
  const parsed = parseBaziInput(raw);
  if (!parsed.ok) return parsed;
  const input = parsed.result;
  if (input.calendar === "lunar") {
    const checked = validateLunar(input);
    if (!checked.ok) return checked;
  }

  try {
    if (input.hour !== null) {
      const solar = solarFromInput(input, input.hour, input.minute, input.second);
      if (!solar.ok) return solar;
      const at = solar.result;
      const core = readCore(at, input.sect, "given-clock");
      const hour = readHour(at, input.sect);
      const pillars = [core.year, core.month, core.day, hour.pillar];
      const ten: TenGods = {
        dayMasterStem: core.ten.dayMasterStem,
        stems: { ...core.ten.stems, hour: hour.shiShenGan },
        branches: { ...core.ten.branches, hour: hour.shiShenZhi },
      };
      return ok(finish(input, at, {
        year: { status: "known", value: core.year },
        month: { status: "known", value: core.month },
        day: { status: "known", value: core.day },
        hour: { status: "known", value: hour.pillar },
      }, {
        status: "known",
        stem: core.day.gan,
        label: "日主",
      }, {
        status: "known",
        ...ten,
      }, {
        status: "known",
        pillarsIncluded: ["year", "month", "day", "hour"],
        counts: countSurface(pillars),
      }, {
        status: "known",
        pillarsIncluded: ["year", "month", "day", "hour"],
        counts: countHidden(pillars),
        source: "EightChar.get*HideGan + LunarUtil.WU_XING_GAN",
      }, "时辰已知，四柱都来自该钟点。"));
    }

    const solarDate = solarFromInput(input, 0, 0, 0);
    if (!solarDate.ok) return solarDate;
    const noonDate = solarFromInput(input, 12, 0, 0);
    if (!noonDate.ok) return noonDate;
    if (
      solarDate.result.year !== noonDate.result.year ||
      solarDate.result.month !== noonDate.result.month ||
      solarDate.result.day !== noonDate.result.day
    ) {
      return fail(
        "LUNAR_DAY_SOLAR_DATE_UNSTABLE",
        "这条农历日在 0 点与 12 点换到的公历日期不同。时辰未知时本程序拒绝猜测，不排盘。",
      );
    }
    const civil = {
      year: solarDate.result.year,
      month: solarDate.result.month,
      day: solarDate.result.day,
    };
    const jie = jieOnCivilDate(civil.year, civil.month, civil.day);
    if (jie === "multiple") {
      return fail("UNSUPPORTED_MULTIPLE_JIE", "这一公历日有多于一个节，未知时辰时无法安全拆分，已拒绝排盘。");
    }
    const probes: { label: string; at: Clock }[] = [];
    if (jie) {
      const boundary: Clock = { ...civil, hour: jie.hour, minute: jie.minute, second: jie.second };
      probes.push({ label: `before:${jie.name}`, at: addMinutes(boundary, -1) });
      probes.push({ label: `after:${jie.name}`, at: addMinutes(boundary, 1) });
    } else {
      probes.push({
        label: "reference-08:00-not-birth-hour",
        at: { ...civil, hour: 8, minute: 0, second: 0 },
      });
    }
    if (input.sect === 1) {
      probes.push({
        label: "late-zi-23:30-sect1",
        at: { ...civil, hour: 23, minute: 30, second: 0 },
      });
    }
    const cores = probes.map((probe) => readCore(probe.at, input.sect, probe.label));
    const yearSlot = mergeSlot(cores.map((core) => ({ label: core.label, value: core.year })));
    const monthSlot = mergeSlot(cores.map((core) => ({ label: core.label, value: core.month })));
    const daySlot = mergeSlot(cores.map((core) => ({ label: core.label, value: core.day })));
    const dayStems = [...new Set(cores.map((core) => core.day.gan))];
    const dayMaster =
      dayStems.length === 1
        ? { status: "known" as const, stem: dayStems[0], label: "日主" }
        : {
            status: "ambiguous" as const,
            stem: null,
            label: "日主",
            candidates: cores
              .filter((core, index) => cores.findIndex((item) => item.day.gan === core.day.gan) === index)
              .map((core) => ({ label: core.label, stem: core.day.gan })),
            reason: "日主随日柱改变。未知时辰下这些读数的日干不一致，不输出单一日主。",
          };
    const tenUnique = new Map<string, Core>();
    for (const core of cores) {
      const key = `${core.ten.dayMasterStem}|${core.ten.stems.year}|${core.ten.stems.month}|${core.ten.branches.year.join(",")}|${core.ten.branches.month.join(",")}|${core.ten.branches.day.join(",")}`;
      if (!tenUnique.has(key)) tenUnique.set(key, core);
    }
    const tenGods =
      tenUnique.size === 1
        ? {
            status: "known" as const,
            dayMasterStem: cores[0].ten.dayMasterStem,
            stems: { ...cores[0].ten.stems, hour: null },
            branches: { ...cores[0].ten.branches, hour: null },
            hourStatus: "unknown" as const,
          }
        : {
            status: "ambiguous" as const,
            hourStatus: "unknown" as const,
            reason: "十神随日主改变，或年月柱本身不一致。不输出单一十神。",
            candidates: [...tenUnique.values()].map((core) => ({
              label: core.label,
              dayMasterStem: core.ten.dayMasterStem,
              stems: { ...core.ten.stems, hour: null },
              branches: { ...core.ten.branches, hour: null },
            })),
          };
    const combos = new Map<string, Core>();
    for (const core of cores) {
      const key = `${core.year.ganZhi}|${core.month.ganZhi}|${core.day.ganZhi}`;
      if (!combos.has(key)) combos.set(key, core);
    }
    const surface =
      combos.size === 1
        ? {
            status: "known" as const,
            pillarsIncluded: ["year", "month", "day"],
            counts: countSurface([cores[0].year, cores[0].month, cores[0].day]),
          }
        : {
            status: "ambiguous" as const,
            pillarsIncluded: ["year", "month", "day"],
            candidates: [...combos.values()].map((core) => ({
              label: core.label,
              counts: countSurface([core.year, core.month, core.day]),
            })),
          };
    const hidden =
      combos.size === 1
        ? {
            status: "known" as const,
            pillarsIncluded: ["year", "month", "day"],
            counts: countHidden([cores[0].year, cores[0].month, cores[0].day]),
            source: "EightChar.get*HideGan + LunarUtil.WU_XING_GAN",
          }
        : {
            status: "ambiguous" as const,
            pillarsIncluded: ["year", "month", "day"],
            source: "EightChar.get*HideGan + LunarUtil.WU_XING_GAN",
            candidates: [...combos.values()].map((core) => ({
              label: core.label,
              counts: countHidden([core.year, core.month, core.day]),
            })),
          };
    return ok(
      finish(
        input,
        { ...civil, hour: 0, minute: 0, second: 0 },
        {
          year: yearSlot,
          month: monthSlot,
          day: daySlot,
          hour: {
            status: "unknown",
            value: null,
            reason: "时辰未知。没有用午时、子时或任何钟点填时柱。",
          },
        },
        dayMaster,
        tenGods,
        surface,
        hidden,
        jie
          ? `该公历日有节「${jie.name}」交接（库内钟面 ${String(jie.hour).padStart(2, "0")}:${String(jie.minute).padStart(2, "0")}:${String(jie.second).padStart(2, "0")}）。未知时辰不判断出生在交接前还是后。`
          : "这一公历日没有十二节交接。年月日柱用 08:00 只作读取锚点；该锚点的时柱已丢弃。",
      ),
    );
  } catch (error) {
    return fail("ENGINE_FAILED", `排盘失败，未返回替代结果：${error instanceof Error ? error.message : String(error)}`);
  }
}


export const ZONED_RULE_VERSION = "bazi-zoned-v2";

function clockFromLocal(value: string): Clock {
  const numbers = value.slice(0, 19).match(/\d+/g)?.map(Number);
  if (!numbers || numbers.length < 5) throw new Error("时间适配器未返回钟面字段。");
  return {year:numbers[0],month:numbers[1],day:numbers[2],hour:numbers[3],minute:numbers[4],second:numbers[5] ?? 0};
}

function clockString(clock: Clock): string {
  const p = (n:number) => String(n).padStart(2,"0");
  return `${String(clock.year).padStart(4,"0")}-${p(clock.month)}-${p(clock.day)}T${p(clock.hour)}:${p(clock.minute)}:${p(clock.second)}`;
}

export function computeBazi(raw: unknown): Result<Record<string, unknown>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return computeLegacyBazi(raw);
  const obj = raw as Record<string,unknown>;
  if (obj.timezone === undefined && obj.timeStandard === undefined && obj.longitude === undefined && obj.disambiguation === undefined)
    return computeLegacyBazi(raw); // 保留旧接口：钟面预先换成东八区。
  const parsed = parseBaziInput(raw);
  if (!parsed.ok) return parsed;
  const input = parsed.result;
  const timezone = obj.timezone;
  const timeStandard = obj.timeStandard ?? "civil";
  const disambiguation = obj.disambiguation ?? "reject";
  if (typeof timezone !== "string" || !timezone) return fail("MISSING_TIMEZONE","时区换算请提供出生地 IANA 时区。");
  if (timeStandard !== "civil" && timeStandard !== "true-solar") return fail("INVALID_TIME_STANDARD","timeStandard 只能是 civil 或 true-solar。");
  if (disambiguation !== "reject" && disambiguation !== "earlier" && disambiguation !== "later") return fail("INVALID_TIME_DISAMBIGUATION","disambiguation 只能是 reject、earlier 或 later。");
  if (timeStandard === "true-solar" && (typeof obj.longitude !== "number" || !Number.isFinite(obj.longitude) || Math.abs(obj.longitude) > 180))
    return fail("MISSING_LONGITUDE","真太阳时需要已知出生经度（东正西负，−180 至 180 度）。");
  if (input.calendar === "lunar" && timezone !== "Asia/Shanghai")
    return fail("LUNAR_ZONE_UNSUPPORTED","农历日期按中国历法解释。其他时区的记录请给出当地公历日期再换算。");
  if (input.calendar === "lunar") {const checked=validateLunar(input); if (!checked.ok) return checked;}
  try {
    if (input.hour === null) {
      // 未知时间无法唯一建立时刻，不以当地正午或午夜替代生日时刻。
      validateZone(timezone);
      if(input.year<YEAR_MIN||input.year>YEAR_MAX)return fail("DATE_OUT_OF_RANGE", "时区排盘仅支持 1900 至 2100 年。");
      const slot = () => ({status:"unknown",value:null,reason:"缺出生钟点；未换算 UTC。"});
      return ok({pillars:{year:slot(),month:slot(),day:slot(),hour:slot()},
        dayMaster:{status:"unknown",stem:null}, tenGods:{status:"unknown"}, elements:{status:"unknown"},
        provenance:{engine:"lunar-javascript",engineVersion:engineVersion(),ruleVersion:ZONED_RULE_VERSION,
          timezone, timeStandard, hourKnown:false, noonSubstitution:false, missingInputs:["birth_time"]}});
    }
    const civil = solarFromInput(input,input.hour,input.minute,input.second);
    if (!civil.ok) return civil;
    const timing = civilToUtc({local:clockString(civil.result),timezone,disambiguation});
    const east8 = new Date(new Date(timing.utc).valueOf() + 8 * 60 * 60 * 1000);
    const eventClock = clockFromLocal(east8.toISOString());
    const solar = timeStandard === "true-solar" ? trueSolarTime({utc:timing.utc,longitude:obj.longitude as number}) : null;
    const dayClock = solar ? clockFromLocal(solar.solar_local) : civil.result;
    const ym = readCore(eventClock,input.sect,"instant-at-fixed-utc-plus-08");
    const d = readCore(dayClock,input.sect,"chosen-local-day-clock");
    const h = readHour(dayClock,input.sect);
    const dayGan = d.day.gan;
    const classify = (stem:string) => {
      const name = LunarUtil.SHI_SHEN[dayGan+stem];
      if (!name) throw new Error("lunar-javascript 未返回十神映射。");
      return name;
    };
    const {year,month} = ym; const day=d.day; const hour=h.pillar;
    const piles=[year,month,day,hour];
    const full = finish(input,civil.result,
      {year:{status:"known",value:year},month:{status:"known",value:month},day:{status:"known",value:day},hour:{status:"known",value:hour}},
      {status:"known",stem:dayGan,label:"日主"},
      {status:"known",dayMasterStem:dayGan,stems:{year:classify(year.gan),month:classify(month.gan),day:d.ten.stems.day,hour:h.shiShenGan},
        branches:{year:year.hideGan.map(classify),month:month.hideGan.map(classify),day:d.ten.branches.day,hour:h.shiShenZhi}},
      {status:"known",pillarsIncluded:["year","month","day","hour"],counts:countSurface(piles)},
      {status:"known",pillarsIncluded:["year","month","day","hour"],counts:countHidden(piles),source:"EightChar.get*HideGan + LunarUtil.WU_XING_GAN"},
      "年、月柱按 UTC+08:00 固定节气钟面；日、时柱按选择的当地钟面和流派。");
    return ok({...full, provenance:{...full.provenance,ruleVersion:ZONED_RULE_VERSION,timezoneConversion:"iana-civil-to-utc",
      trueSolarTime:solar !== null,timeStandard,timezone,timing,jieClock:clockString(eventClock),dayHourClock:clockString(dayClock),trueSolarDetails:solar}});
  } catch(error) {
    if (error instanceof TimeInputError) return fail(error.code,error.message,error.code==="AMBIGUOUS_LOCAL_TIME"?error.details:undefined);
    if (error instanceof RangeError) return fail("INVALID_TIMEZONE","时区无效或不在换算支持区间。");
    return fail("ENGINE_FAILED","时间换算或四柱计算失败，没有替代盘。");
  }
}

function finish(
  input: BaziInput,
  solar: Clock,
  pillars: { year: Slot<Pillar>; month: Slot<Pillar>; day: Slot<Pillar>; hour: Slot<Pillar> },
  dayMaster: Record<string, unknown>,
  tenGods: Record<string, unknown>,
  surface: Record<string, unknown>,
  hidden: Record<string, unknown>,
  readingNote: string,
) {
  let lunarText: string | null = null;
  try {
    lunarText = Solar.fromYmd(solar.year, solar.month, solar.day).getLunar().toString();
  } catch {
    lunarText = null;
  }
  return {
    provenance: provenance(input, {
      hourKnown: input.hour !== null,
      unknownHourPolicy: input.hour === null ? "omit-hour-pillar" : "not-applicable",
      readingNote,
    }),
    input: {
      calendar: input.calendar,
      year: input.year,
      month: input.month,
      day: input.day,
      hour: input.hour,
      minute: input.hour === null ? null : input.minute,
      second: input.hour === null ? null : input.second,
      leap: input.leap,
      sect: input.sect,
      gender: input.gender,
    },
    resolvedSolar: { year: solar.year, month: solar.month, day: solar.day },
    lunarDateText: lunarText,
    lunarDateNote: "这是公历日期对应的农历日期串，不含时辰。时柱以 pillars.hour 为准。",
    dayMaster,
    pillars,
    tenGods,
    elements: {
      elementCountsArePersonalityMeasures: false,
      note: "这是已纳入柱上的五行标签计数，不是性格、能力或命运测量。时辰未知时不含时柱。柱不确定时不合并成一个计数。",
      surface: {
        ...surface,
        meaning: "天干与地支的五行标签。来自 EightChar.get*WuXing，每柱两字。",
      },
      hiddenStems: {
        ...hidden,
        meaning: "地支藏干的五行标签，单独计数，不并入 surface。",
      },
    },
    genderUsedInCalculation: false,
  };
}
