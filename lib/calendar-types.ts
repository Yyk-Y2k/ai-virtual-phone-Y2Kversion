export type CalendarOwnerType = "user" | "character";

export type CalendarColorKey =
  | "blue"
  | "green"
  | "amber"
  | "rose"
  | "violet"
  | "teal"
  | "slate"
  | "lilac";

export type CalendarScheduleItem = {
  id: string;
  date: string;       // YYYY-MM-DD
  weekday: string;    // 周一 ~ 周日
  startTime: string;  // HH:MM
  endTime: string;    // HH:MM
  location: string;
  title: string;
  /** 事项 emoji 图标（可选，一个 emoji） */
  emoji?: string;
  colorKey: CalendarColorKey;
  /** 有限日期范围的每周重复组；编辑/删除时作用于整组 */
  recurrence?: {
    seriesId: string;
    startDate: string;
    until: string;
    weekdays: number[]; // JavaScript weekday: 0=周日，1=周一
    excludedDates?: string[]; // 从重复组中单独删除的日期
  };
  source: "manual" | "generated";
  createdAt: string;
  updatedAt: string;
};

export type CalendarWeekPlan = {
  id: string;
  ownerType: CalendarOwnerType;
  ownerId: string;
  weekStart: string; // YYYY-MM-DD, Monday
  items: CalendarScheduleItem[];
  updatedAt: string;
};
