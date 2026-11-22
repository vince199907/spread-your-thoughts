import {test} from 'node:test';
import assert from 'node:assert/strict';
import {civilDayInterval, civilToUtc, utcToCivil, trueSolarTime, TimeInputError} from '../src/timezone.js';
import {calculateAstrology} from '../src/astrology_adapter.js';

const code = (name: string) => (error:unknown) => error instanceof TimeInputError && error.code === name;

test('Shanghai historical summer offset comes from IANA, not modern Asia/Shanghai offset', () => {
  // https://data.iana.org/time-zones/tzdb/asia: PRC 1989 started DST in April.
  const summer = civilToUtc({local:'1989-04-17T12:00',timezone:'Asia/Shanghai'});
  const winter = civilToUtc({local:'1989-04-13T12:00',timezone:'Asia/Shanghai'});
  assert.equal(summer.utc,'1989-04-17T03:00:00.000Z');
  assert.equal(summer.offset,'+09:00');
  assert.equal(winter.utc,'1989-04-13T04:00:00.000Z');
  assert.equal(winter.offset,'+08:00');
});

test('UTC and zoned conversion round-trip across midnight with quarter-hour offset', () => {
  const input = {local:'2024-01-01T00:15:20.125',timezone:'Asia/Kathmandu'};
  const {utc,offset} = civilToUtc(input);
  assert.equal(utc,'2023-12-31T18:30:20.125Z');
  assert.equal(offset,'+05:45');
  assert.equal(utcToCivil({utc,timezone:input.timezone}).local,input.local);
});

test('nonexistent spring-forward times always reject including explicit earlier/later', () => {
  for (const disambiguation of ['reject','earlier','later'] as const)
    assert.throws(() => civilToUtc({local:'2024-03-10T02:30',timezone:'America/New_York',disambiguation}), code('NONEXISTENT_LOCAL_TIME'));
});

test('ambiguous fall-back reports both UTC choices and requires an explicit choice', () => {
  const input = {local:'2024-11-03T01:30',timezone:'America/New_York'};
  assert.throws(() => civilToUtc(input),(e:unknown)=>{
    assert.ok(e instanceof TimeInputError);
    assert.equal(e.code,'AMBIGUOUS_LOCAL_TIME');
    const c = e.details.candidates as Array<{utc:string;offset:string}>;
    assert.deepEqual(c.map(x=>[x.utc,x.offset]),[['2024-11-03T05:30:00.000Z','-04:00'],['2024-11-03T06:30:00.000Z','-05:00']]);
    return true;
  });
  assert.equal(civilToUtc({...input,disambiguation:'earlier'}).utc,'2024-11-03T05:30:00.000Z');
  assert.equal(civilToUtc({...input,disambiguation:'later'}).utc,'2024-11-03T06:30:00.000Z');
});

test('fold detection handles 30-minute offsets instead of assuming an hour', () => {
  const input = {local:'2024-04-07T01:45',timezone:'Australia/Lord_Howe'};
  assert.equal(civilToUtc({...input,disambiguation:'earlier'}).utc,'2024-04-06T14:45:00.000Z');
  assert.equal(civilToUtc({...input,disambiguation:'later'}).utc,'2024-04-06T15:15:00.000Z');
});

test('a local date is a 23/25 hour interval across DST, and Apia skipped 2011-12-30', () => {
  const duration = (date:string) => {
    const t = civilDayInterval({date,timezone:'America/New_York'});
    return (Date.parse(t.end_utc_exclusive)-Date.parse(t.start_utc))/3600000;
  };
  assert.equal(duration('2024-03-10'),23);
  assert.equal(duration('2024-11-03'),25);
  assert.throws(()=>civilDayInterval({date:'2011-12-30',timezone:'Pacific/Apia'}),code('NONEXISTENT_LOCAL_DATE'));
  assert.throws(()=>civilToUtc({local:'2011-12-30T12:00',timezone:'Pacific/Apia'}),code('NONEXISTENT_LOCAL_TIME'));
});

test('strict Gregorian fields reject rollover, offset suffixes, unknown timezone and leap seconds', () => {
  assert.throws(()=>civilToUtc({local:'2023-02-29T12:00',timezone:'UTC'}), code('INVALID_DATE'));
  assert.throws(()=>civilToUtc({local:'2024-01-01T24:00',timezone:'UTC'}), code('INVALID_LOCAL_TIME'));
  assert.throws(()=>civilToUtc({local:'2024-01-01T14:00Z',timezone:'UTC'}), code('INVALID_LOCAL_TIME'));
  assert.throws(()=>civilToUtc({local:'2024-01-01T14:00',timezone:'+08:00'}), code('INVALID_TIMEZONE'));
  assert.throws(()=>civilToUtc({local:'2024-01-01T14:00',timezone:'CST'}), code('INVALID_TIMEZONE'));
  assert.throws(()=>civilToUtc({local:'2024-01-01T14:00',timezone:'Unknown/City'}), code('INVALID_TIMEZONE'));
  assert.throws(()=>utcToCivil({utc:'2024-01-01T14:00:60Z',timezone:'UTC'}), code('INVALID_UTC_TIME'));
  assert.equal(civilToUtc({local:'2024-02-29T12:00',timezone:'UTC'}).utc,'2024-02-29T12:00:00.000Z');
});

test('true solar clock uses east-positive longitude and distinct seasonal EOT', () => {
  // Independently evaluated USNO q / 15 - RA approximation (wrapped to ±12 h):
  // https://aa.usno.navy.mil/faq/sun_approx. Tolerance is 0.10 min, not millisecond accuracy.
  const a=trueSolarTime({utc:'2024-11-03T12:00:00Z',longitude:0});
  assert.ok(Math.abs(a.equation_of_time_minutes-16.4435)<0.1);
  const b=trueSolarTime({utc:'2024-02-11T12:00:00Z',longitude:0});
  assert.ok(Math.abs(b.equation_of_time_minutes+14.2019)<0.1);
  const e=trueSolarTime({utc:a.utc,longitude:120});
  assert.equal(e.longitude_minutes,480);
  assert.equal(e.solar_local,a.solar_local.replace('T12:','T20:'));
  assert.equal(e.utc,a.utc);
  assert.throws(()=>trueSolarTime({utc:a.utc,longitude:181}),code('INVALID_LONGITUDE'));
});

test('tropical signs match both sides of USNO 2024 season boundaries, including wraparound', () => {
  // https://aa.usno.navy.mil/calculated/seasons?dst=false&submit=Get+Data&tz=0&tz_label=true&tz_sign=0&year=2024
  const cases = [
    ['2024-03-20T03:06:00Z','双鱼座','白羊座'],
    ['2024-06-20T20:51:00Z','双子座','巨蟹座'],
    ['2024-09-22T12:44:00Z','处女座','天秤座'],
    ['2024-12-21T09:20:00Z','射手座','摩羯座'],
  ];
  for(const [cusp,before,after] of cases){
    assert.equal(calculateAstrology({utc:new Date(Date.parse(cusp)-300000).toISOString()}).facts?.sun.sign,before);
    assert.equal(calculateAstrology({utc:new Date(Date.parse(cusp)+300000).toISOString()}).facts?.sun.sign,after);
  }
});

test('date-only cusp keeps possible signs and never fills missing ascendant or longitude', () => {
  const result = calculateAstrology({date:'2024-03-20',timezone:'Asia/Shanghai',mode:'planetary'});
  assert.equal(result.calculation_status,'partial');
  assert.deepEqual(result.facts,{sun:{sign:null,possible_signs:['双鱼座','白羊座']}});
  assert.deepEqual(result.missing_inputs,['time']);
  assert.deepEqual(calculateAstrology({date:'2024-05-15'}).facts,{sun:{sign:'金牛座',possible_signs:['金牛座']}});
});

test('date-only without timezone expands rather than guessing location or noon', () => {
  const result = calculateAstrology({date:'2024-03-20'});
  assert.deepEqual(result.missing_inputs,['time','timezone']);
  if (result.calculation_status !== "partial") assert.fail("expected partial");
  assert.deepEqual(result.time_basis,{
    start_utc:'2024-03-19T10:00:00.000Z',end_utc_exclusive:'2024-03-21T12:00:00.000Z',timezone:null,precision:'date-only'
  });
  assert.deepEqual(calculateAstrology({date:'2024-03-20',time:'11:00'}).missing_inputs,['timezone']);
  assert.throws(()=>calculateAstrology({date:'2024-03-20',utc:'2024-03-20T03:08:00Z'}),code('CONFLICTING_TIME_INPUT'));
});

test('point calculation agrees from UTC and matching civil date, with no unverified full-chart fields', () => {
  const u = calculateAstrology({utc:'2024-03-20T03:08:00Z',mode:'planetary'});
  const c = calculateAstrology({date:'2024-03-20',time:'11:08',timezone:'Asia/Shanghai',mode:'planetary'});
  assert.deepEqual(u.facts,c.facts);
  assert.equal(Object.keys(u.facts ?? {}).length,10);
  assert.ok(Object.values(u.facts ?? {}).every(x=>x.longitude_deg>=0 && x.longitude_deg<360));
  assert.ok(!('ascendant' in (u.facts??{})));
  assert.ok(!('houses' in (u.facts??{})));
});

test('Sun, Moon and eight planets match three independent Moshier/Swiss longitude fixtures', () => {
  // Numerical facts from pyswisseph 2.10.3.2 calc_ut(julday(...), body, FLG_MOSEPH).
  // Swiss Ephemeris was used once to cross-check synthetic dates, is not a dependency
  // and is not distributed. These tolerances are for the regression fixtures only.
  const cases = {
    '1910-01-01T00:00:00Z':[279.706802,161.493223,295.698329,322.790645,17.861978,193.275266,16.508684,290.491,108.177057,85.605813],
    '2024-03-20T03:08:00Z':[0.001101,123.832229,17.442943,340.173013,327.774494,44.885962,342.225644,50.253845,357.460259,301.660656],
    '2095-07-22T12:00:00Z':[120.01831,8.794578,136.471176,121.600688,239.060081,68.359224,141.802401,5.677905,154.748956,30.43335],
  };
  const bodyKeys = ['sun','moon','mercury','venus','mars','jupiter','saturn','uranus','neptune','pluto'] as const;
  for (const [utc, expected] of Object.entries(cases)) {
    const reading = calculateAstrology({utc,mode:'planetary'});
    if (reading.calculation_status !== 'ok') assert.fail('expected computed positions');
    for(const [i,name] of bodyKeys.entries()) {
      const body=reading.facts[name];
      assert.ok(body && 'longitude_deg' in body,`${utc} ${name} has no longitude`);
      const distance = Math.abs(((body.longitude_deg-expected[i]+540)%360)-180);
      assert.ok(distance < 0.03,`${utc} ${name}: angular error ${distance} degrees`);
    }
  }
});

test('1991 Shanghai transition dates reject the spring gap and expose both autumn fold choices', () => {
  // IANA tzdb asia, PRC Rules: the first Sunday on/after the 11th of April and
  // September at 02:00; in 1991 those are Apr 14 and Sep 15 respectively.
  const timezone = 'Asia/Shanghai';
  const gap = {local:'1991-04-14T02:30',timezone};
  for (const disambiguation of ['reject','earlier','later'] as const) {
    assert.throws(() => civilToUtc({...gap,disambiguation}),code('NONEXISTENT_LOCAL_TIME'));
  }
  const fold = {local:'1991-09-15T01:30',timezone};
  assert.throws(() => civilToUtc(fold),code('AMBIGUOUS_LOCAL_TIME'));
  const earlier = civilToUtc({...fold,disambiguation:'earlier'});
  const later = civilToUtc({...fold,disambiguation:'later'});
  assert.deepEqual([earlier.utc,earlier.offset],['1991-09-14T16:30:00.000Z','+09:00']);
  assert.deepEqual([later.utc,later.offset],['1991-09-14T17:30:00.000Z','+08:00']);
  assert.equal(utcToCivil({utc:earlier.utc,timezone}).local,'1991-09-15T01:30:00.000');
  assert.equal(utcToCivil({utc:later.utc,timezone}).local,'1991-09-15T01:30:00.000');
});
