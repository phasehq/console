import { AppType, ChartDataPointType, TimeRange } from '@/apollo/graphql'
import { GetAppActivityChart } from '@/apollo/queries/getAppActivityChart.gql'
import { humanReadableNumber } from '@/utils/dataUnits'
import { useLazyQuery } from '@apollo/client'
import { useEffect, useState } from 'react'
import {
  AreaSparklineChart,
  GridlineSeries,
  Gridline,
  AreaSeries,
  Area,
  Stripes,
  Gradient,
  GradientStop,
  Line,
  LinearXAxis,
  LinearXAxisTickSeries,
  LinearXAxisTickLabel,
  LinearYAxis,
  LinearYAxisTickSeries,
  LinearYAxisTickLabel,
  ChartTooltip,
  TooltipArea,
  TooltipTemplate,
} from 'reaviz'
import { Button } from '../common/Button'
import Spinner from '../common/Spinner'

export const AppActivityChart = (props: { app: AppType }) => {
  const [period, setPeriod] = useState<TimeRange>(TimeRange.Day)
  const [getChartData, { data }] = useLazyQuery(GetAppActivityChart)

  useEffect(() => {
    getChartData({
      variables: {
        appId: props.app.id,
        period: period,
      },
      fetchPolicy: 'cache-and-network',
    })
  }, [period])

  const chartData =
    data?.appActivityChart.map((dataPoint: ChartDataPointType) => {
      const timestamp = new Date(dataPoint.date!)
      return {
        id: dataPoint.index!.toString(),
        key: timestamp,
        data: dataPoint.data,
      }
    }) || []

  const chartIsLoading = chartData.length === 0

  const periodTotal = data?.appActivityChart
    ? data?.appActivityChart.reduce(
        (acc: number, curr: ChartDataPointType) => acc + (curr.data ?? 0),
        0
      )
    : 0

  return (
    <div className="space-y-16">
      <div className="flex w-full justify-between">
        <div className="space-y-2">
          <span className="text-4xl font-extralight">{humanReadableNumber(periodTotal)}</span>
          <h2 className="text-2xl font-bold">Events</h2>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant={period === TimeRange.Hour ? 'primary' : 'secondary'}
            disabled={period === TimeRange.Hour}
            onClick={() => setPeriod(TimeRange.Hour)}
          >
            1H
          </Button>
          <Button
            variant={period === TimeRange.Day ? 'primary' : 'secondary'}
            disabled={period === TimeRange.Day}
            onClick={() => setPeriod(TimeRange.Day)}
          >
            24H
          </Button>
          <Button
            variant={period === TimeRange.Week ? 'primary' : 'secondary'}
            disabled={period === TimeRange.Week}
            onClick={() => setPeriod(TimeRange.Week)}
          >
            1W
          </Button>
          <Button
            variant={period === TimeRange.Month ? 'primary' : 'secondary'}
            disabled={period === TimeRange.Month}
            onClick={() => setPeriod(TimeRange.Month)}
          >
            1M
          </Button>
          <Button
            variant={period === TimeRange.Year ? 'primary' : 'secondary'}
            disabled={period === TimeRange.Year}
            onClick={() => setPeriod(TimeRange.Year)}
          >
            1Y
          </Button>
        </div>
      </div>
      {chartIsLoading && (
        <div className="h-[300px] flex items-center justify-center">
          <Spinner size="md" />
        </div>
      )}
      {!chartIsLoading && (
        <AreaSparklineChart
          height={300}
          data={chartData}
          gridlines={<GridlineSeries line={<Gridline direction="all" />} />}
          series={
            <AreaSeries
              colorScheme={'#10b981'}
              interpolation="smooth"
              area={
                <Area
                  mask={<Stripes />}
                  gradient={
                    <Gradient
                      stops={[
                        <GradientStop offset="10%" stopOpacity={0} key="start" />,
                        <GradientStop offset="80%" stopOpacity={1} key="stop" />,
                      ]}
                    />
                  }
                />
              }
              line={<Line strokeWidth={1} />}
              tooltip={
                <TooltipArea
                  tooltip={
                    <ChartTooltip
                      followCursor={true}
                      modifiers={{
                        offset: '5px, 5px',
                      }}
                      content={(data: { x: number; y: number }, color: any) => (
                        <TooltipTemplate
                          color={color}
                          value={{
                            x:
                              period === TimeRange.Hour || period === TimeRange.Day
                                ? new Date(data.x).toLocaleTimeString()
                                : new Date(data.x).toDateString(),
                            y: `${humanReadableNumber(data.y)} decrypts`,
                          }}
                        />
                      )}
                    />
                  }
                />
              }
            />
          }
          xAxis={
            <LinearXAxis
              type="time"
              tickSeries={<LinearXAxisTickSeries label={<LinearXAxisTickLabel rotation={0} />} />}
            />
          }
          yAxis={
            <LinearYAxis
              type="value"
              tickSeries={<LinearYAxisTickSeries label={<LinearYAxisTickLabel />} />}
            />
          }
        />
      )}
    </div>
  )
}
