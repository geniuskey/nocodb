import { ColumnType } from "~/lib/Api"
import UITypes from "~/lib/UITypes"
import { TimeHelper } from "./Time"

describe('columnHelper', () => {
  describe('Time', () => {
    describe('equalityComparison', () => {
      // Known frozen-baseline defect: https://github.com/geniuskey/nocodb/issues/62
      it.failing(`will compare two time`, () => {
        const column = {
          uidt: UITypes.Time,
          meta: {
            time_format: 'HH:mm'
          }
        } as ColumnType;
        const a = '02:15';
        const b = '1999-01-01 02:15:00+07:00';

        const result = new TimeHelper().equalityComparison(a, b, {col: column})
        expect(result).toBe(true)
      })
    })
  })
})
