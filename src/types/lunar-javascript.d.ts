declare module "lunar-javascript" {
  export interface Solar {
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getHour(): number;
    getMinute(): number;
    getSecond(): number;
    toYmd(): string;
    toYmdHms(): string;
    getLunar(): Lunar;
  }

  export interface Lunar {
    toString(): string;
    getSolar(): Solar;
    getEightChar(): EightChar;
    getJieQiTable(): Record<string, Solar>;
  }

  export interface EightChar {
    getSect(): number;
    setSect(sect: number): void;
    getYear(): string;
    getMonth(): string;
    getDay(): string;
    getTime(): string;
    getYearGan(): string;
    getMonthGan(): string;
    getDayGan(): string;
    getTimeGan(): string;
    getYearZhi(): string;
    getMonthZhi(): string;
    getDayZhi(): string;
    getTimeZhi(): string;
    getYearWuXing(): string;
    getMonthWuXing(): string;
    getDayWuXing(): string;
    getTimeWuXing(): string;
    getYearShiShenGan(): string;
    getMonthShiShenGan(): string;
    getDayShiShenGan(): string;
    getTimeShiShenGan(): string;
    getYearShiShenZhi(): string[];
    getMonthShiShenZhi(): string[];
    getDayShiShenZhi(): string[];
    getTimeShiShenZhi(): string[];
    getYearHideGan(): string[];
    getMonthHideGan(): string[];
    getDayHideGan(): string[];
    getTimeHideGan(): string[];
  }

  export interface LunarYear {
    getLeapMonth(): number;
  }

  export interface LunarMonth {
    getDayCount(): number;
    isLeap(): boolean;
    getMonth(): number;
  }

  export const Solar: {
    fromYmd(year: number, month: number, day: number): Solar;
    fromYmdHms(
      year: number,
      month: number,
      day: number,
      hour: number,
      minute: number,
      second: number,
    ): Solar;
  };

  export const Lunar: {
    fromYmd(year: number, month: number, day: number): Lunar;
    fromYmdHms(
      year: number,
      month: number,
      day: number,
      hour: number,
      minute: number,
      second: number,
    ): Lunar;
  };

  export const LunarYear: {
    fromYear(year: number): LunarYear;
  };

  export const LunarMonth: {
    fromYm(year: number, month: number): LunarMonth;
  };

  export const LunarUtil: {
    SHI_SHEN: Record<string, string>;
    WU_XING_GAN: Record<string, string>;
    WU_XING_ZHI: Record<string, string>;
  };
}
