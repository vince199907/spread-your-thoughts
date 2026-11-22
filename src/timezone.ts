import { Temporal } from '@js-temporal/polyfill';
import { Body, EquatorFromVector, GeoVector, RotateVector, Rotation_EQJ_EQD, SiderealTime } from 'astronomy-engine';

export const TIME_RULES_VERSION = 'iana-temporal-0.5.1+apparent-solar-ae-2.1.19-v1';
export const YEAR_MIN = 1900;
export const YEAR_MAX = 2100;

export type FoldChoice = 'reject'|'earlier'|'later';
export interface CivilInput { local:string; timezone:string; disambiguation?:FoldChoice }
export interface UtcInput { utc:string; timezone:string }
export interface LocalDateInput { date:string; timezone:string }

export class TimeInputError extends RangeError {
  constructor(public readonly code:string, message:string, public readonly details:Record<string,unknown> = {}) {
    super(message); this.name = 'TimeInputError';
  }
}

export function parseDate(date: unknown) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TimeInputError('INVALID_DATE', '请输入 YYYY-MM-DD 格式的公历日期。');
  const year = Number(date.slice(0, 4));
  if (year < YEAR_MIN || year > YEAR_MAX) throw new TimeInputError('DATE_OUT_OF_RANGE', `公历输入仅支持 ${YEAR_MIN} 至 ${YEAR_MAX} 年。`);
  try { return Temporal.PlainDate.from(date, {overflow: 'reject'}); }
  catch { throw new TimeInputError('INVALID_DATE', '这不是有效的公历日期。'); }
}

export function parseCivil(local: unknown) {
  if (typeof local !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(local)) throw new TimeInputError('INVALID_LOCAL_TIME', '请输入无时区后缀的 YYYY-MM-DDTHH:mm[:ss[.SSS]]，不接受闰秒。');
  parseDate(local.slice(0, 10));
  return Temporal.PlainDateTime.from(local, {overflow: 'reject'});
}

export function validateZone(timezone: unknown) {
  if (typeof timezone !== 'string' || !/^(?:UTC|[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+)$/.test(timezone)) {
    throw new TimeInputError('INVALID_TIMEZONE', '请输入明确的 IANA 时区（如 Asia/Shanghai 或 UTC）；不接受 CST 或数字偏移代替历史时区。');
  }
  try { new Intl.DateTimeFormat('en', {timeZone: timezone}); }
  catch { throw new TimeInputError('INVALID_TIMEZONE', '当前时区数据库不识别该 IANA 时区。'); }
  return timezone;
}

export function parseUtc(utc: unknown) {
  if (typeof utc !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(utc)) throw new TimeInputError('INVALID_UTC_TIME', '请输入带 Z 后缀的 UTC 时间，精度最多毫秒。');
  try {
    const plain = Temporal.PlainDate.from(utc.slice(0, 10), {overflow:'reject'});
    // A valid civil input at either supported endpoint can spill over into the adjacent UTC year.
    if (plain.year < YEAR_MIN - 1 || plain.year > YEAR_MAX + 1) throw new TimeInputError('DATE_OUT_OF_RANGE', 'UTC 时间超出支持范围。');
    return Temporal.Instant.from(utc);
  } catch (error) {
    if (error instanceof TimeInputError) throw error;
    throw new TimeInputError('INVALID_UTC_TIME', '这不是有效的 UTC 时间。');
  }
}

const fmtInstant = (i: Temporal.Instant) => i.toString({smallestUnit: 'millisecond'});
const fmtCivil = (x: Temporal.PlainDateTime) => x.toString({smallestUnit: 'millisecond'});
function snapshot(z:Temporal.ZonedDateTime) {
  return {
    utc: fmtInstant(z.toInstant()), local: fmtCivil(z.toPlainDateTime()),
    timezone: z.timeZoneId, offset: z.offset,
  };
}

/** Gaps are always rejected. Folds require explicit earlier/later selection. */
export function civilToUtc({local, timezone, disambiguation = 'reject'}:CivilInput) {
  if (!['reject','earlier','later'].includes(disambiguation)) throw new TimeInputError('INVALID_DISAMBIGUATION', '重叠时间只接受明确选择 earlier 或 later。');
  const plain = parseCivil(local);
  const zone = validateZone(timezone);
  const earlier = plain.toZonedDateTime(zone, {disambiguation:'earlier'});
  const later = plain.toZonedDateTime(zone, {disambiguation:'later'});
  if (!earlier.toPlainDateTime().equals(plain) || !later.toPlainDateTime().equals(plain)) {
    throw new TimeInputError('NONEXISTENT_LOCAL_TIME', '该当地钟点因时区调整不存在，请核对出生记录。', {timezone,local});
  }
  const fold = Temporal.ZonedDateTime.compare(earlier, later) !== 0;
  if (fold && disambiguation === 'reject') {
    throw new TimeInputError('AMBIGUOUS_LOCAL_TIME', '该当地钟点对应两个时刻，请选择较早或较晚的一次。', {
      candidates: [earlier,later].map(snapshot)
    });
  }
  const z = fold && disambiguation === 'later' ? later : earlier;
  return {...snapshot(z), disambiguation: fold ? disambiguation : 'unambiguous', rules_version: TIME_RULES_VERSION} as const;
}

export function utcToCivil({utc,timezone}:UtcInput) {
  const z = parseUtc(utc).toZonedDateTimeISO(validateZone(timezone));
  return {...snapshot(z),rules_version:TIME_RULES_VERSION};
}

/** Real local civil-date interval. Midnight gaps use the first instant on the date.
 * This is for uncertainty intervals ONLY, not a fallback for a nonexistent birth clock time. */
export function civilDayInterval({date,timezone}:LocalDateInput) {
  const day = parseDate(date);
  const zone = validateZone(timezone);
  const start = day.toZonedDateTime(zone);
  if (!start.toPlainDate().equals(day)) throw new TimeInputError('NONEXISTENT_LOCAL_DATE', '该当地日期因时区调整整日跳过。');
  const end = day.add({days:1}).toZonedDateTime(zone);
  return {start_utc:fmtInstant(start.toInstant()),end_utc_exclusive:fmtInstant(end.toInstant())};
}

const mod = (x:number,n:number) => ((x%n)+n)%n;
const signed = (x:number,n:number) => mod(x+n/2,n)-n/2;

/** Geocentric apparent solar time: east-signed longitude and apparent solar
 * hour angle from Astronomy Engine. Output is NOT another real UTC instant.
 */
export function trueSolarTime({utc, longitude}:{utc:string; longitude:number}) {
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new TimeInputError('INVALID_LONGITUDE','请明确输入 -180 至 180 度的经度，东经为正。');
  const instant = parseUtc(utc);
  const date = new Date(instant.epochMilliseconds);
  const eqd = RotateVector(Rotation_EQJ_EQD(date), GeoVector(Body.Sun, date, true));
  const ra = EquatorFromVector(eqd).ra;
  const utcHour = date.getUTCHours() + date.getUTCMinutes()/60 + date.getUTCSeconds()/3600 + date.getUTCMilliseconds()/3600000;
  const apparentGreenwich = mod(SiderealTime(date) - ra + 12,24);
  const eotMs = Math.round(signed(apparentGreenwich-utcHour,24)*3600000);
  const longitudeMs = Math.round(longitude*240000);
  const local = instant.add({milliseconds:eotMs+longitudeMs}).toZonedDateTimeISO('UTC').toPlainDateTime();
  return {
    utc:fmtInstant(instant), solar_local:fmtCivil(local), longitude_degrees_east:longitude,
    equation_of_time_minutes:eotMs/60000, longitude_minutes:longitudeMs/60000,
    method:'geocentric-apparent-solar-time', rules_version:TIME_RULES_VERSION,
    limits:['太阳时钟面不是 UTC，也不带民用时区；不会自动用于八字节气或换日规则。','无高精度 UT1 或地方视差校正；临界时刻请保留不确定性。'],
  };
}
