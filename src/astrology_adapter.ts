import { Body, Ecliptic, EclipticGeoMoon, GeoVector, SunPosition } from 'astronomy-engine';
import { civilDayInterval, civilToUtc, parseDate, parseUtc, TimeInputError, TIME_RULES_VERSION } from './timezone.js';

import type { FoldChoice } from './timezone.js';

export interface AstrologyInput {
  date?:string; time?:string; timezone?:string; utc?:string;
  disambiguation?:FoldChoice; mode?:'basic'|'planetary';
}
export interface BodyPosition { longitude_deg:number; sign:string }
export interface AstrologyFacts {
  sun: BodyPosition | {sign:string|null; possible_signs:string[]};
  moon?:BodyPosition; mercury?:BodyPosition; venus?:BodyPosition; mars?:BodyPosition;
  jupiter?:BodyPosition; saturn?:BodyPosition; uranus?:BodyPosition; neptune?:BodyPosition; pluto?:BodyPosition;
}

export const ASTROLOGY_VERSION = 'astronomy-engine-2.1.19-geocentric-tropical-v1';
const ZODIAC = Object.freeze(['白羊座','金牛座','双子座','巨蟹座','狮子座','处女座','天秤座','天蝎座','射手座','摩羯座','水瓶座','双鱼座']);
const PLANETS = Object.freeze([Body.Mercury, Body.Venus, Body.Mars, Body.Jupiter, Body.Saturn, Body.Uranus, Body.Neptune, Body.Pluto]);
const DAY = 86400000;
const HOUR = 3600000;
const normalizeAngle = (x:number) => ((x % 360)+360)%360;
const signFor = (x:number) => ZODIAC[Math.floor(normalizeAngle(x)/30)];
const iso = (epoch:number) => new Date(epoch).toISOString();
const sun = (epoch:number) => SunPosition(new Date(epoch)).elon;

const base = () => ({
  source_versions: { astronomy: ASTROLOGY_VERSION, timezone: TIME_RULES_VERSION },
  system:'tropical-geocentric',
  limits:['黄道分区为象征框架，并非心理测量或预测。','不计算上升、宫位、恒星黄道或相位。'],
});
const position = (x:number) => ({
  longitude_deg: normalizeAngle(x),
  sign: signFor(x)
});

/** Date only returns possible signs over the entire civil day, not a noon substitution.
 * Time-zone-free date uses the globally conservative UTC offset envelope -12:00…+14:00.
 */
export function calculateAstrology({date, time, timezone, utc, disambiguation, mode='basic'}:AstrologyInput = {}) {
  if (!['basic','planetary'].includes(mode)) throw new TimeInputError('UNSUPPORTED_ASTROLOGY_MODE','仅支持基础太阳和地心行星黄经；不支持完整星盘。');
  if (utc !== undefined && (date !== undefined || time !== undefined || timezone !== undefined || disambiguation !== undefined)) {
    throw new TimeInputError('CONFLICTING_TIME_INPUT','UTC 时间与当地出生日期、时钟、时区只选一种输入。');
  }
  if (utc === undefined && date === undefined) return {...base(),calculation_status:'unknown' as const,missing_inputs:['date'],facts:null};
  if (date !== undefined) parseDate(date);
  if (utc === undefined && time !== undefined && !timezone) return {...base(),calculation_status:'unknown' as const,missing_inputs:['timezone'],facts:null};
  if (utc !== undefined || time !== undefined) {
    const civil = utc === undefined ? civilToUtc({local:`${date}T${time}`,timezone:timezone!,disambiguation}) : null;
    const instant = parseUtc(civil ? civil.utc : utc!);
    const when = new Date(instant.epochMilliseconds);
    const facts: AstrologyFacts = { sun:position(SunPosition(when).elon) };
    if (mode === 'planetary') {
      facts.moon = position(EclipticGeoMoon(when).lon);
      for (const body of PLANETS) facts[body.toLowerCase() as Exclude<keyof AstrologyFacts,'sun'|'moon'>] = position(Ecliptic(GeoVector(body,when,true)).elon);
    }
    return {...base(),calculation_status:'ok' as const,missing_inputs:[],facts,time_basis:civil ?? {utc:instant.toString({smallestUnit:'millisecond'})}};
  }
  // Midnight UTC is only the mathematical center used to establish the UTC-offset envelope.
  const midnight = Date.parse(`${date}T00:00:00Z`);
  const interval = timezone ? civilDayInterval({date:date!,timezone}) :
    {start_utc:iso(midnight-14*HOUR),end_utc_exclusive:iso(midnight+DAY+12*HOUR)};
  const startSign = signFor(sun(Date.parse(interval.start_utc)));
  const endSign = signFor(sun(Date.parse(interval.end_utc_exclusive)-1));
  const possibleSigns = [...new Set([startSign,endSign])];
  // In this time envelope the apparent Sun moves < 3°, so a wrap or one cusp aside
  // the interval cannot cross another 30° sign without changing its endpoint signs.
  return {
    ...base(),calculation_status:'partial' as const,
    missing_inputs: [...(possibleSigns.length>1 || mode==='planetary' ? ['time'] : []),
      ...(!timezone && (possibleSigns.length>1 || mode==='planetary') ? ['timezone'] : [])],
    facts: {sun:{sign:possibleSigns.length===1?possibleSigns[0]:null,possible_signs:possibleSigns}},
    time_basis:{...interval,timezone:timezone??null,precision:'date-only'},
  };
}
