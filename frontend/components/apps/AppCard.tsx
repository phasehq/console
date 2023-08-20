import { useQuery } from '@apollo/client'
import { FaCube } from 'react-icons/fa'
import { Card } from '../common/Card'
import Spinner from '../common/Spinner'
import { GetAppActivityChart } from '@/graphql/queries/getAppActivityChart.gql'
import { AppType, ChartDataPointType, TimeRange } from '@/apollo/graphql'
import {
  Area,
  AreaSeries,
  AreaSparklineChart,
  Gradient,
  GradientStop,
  Line,
  Stripes,
  TooltipArea,
} from 'reaviz'

interface AppCardProps {
  app: AppType
}

export const AppCard = (props: AppCardProps) => {
  const { name, id } = props.app

  const { data } = useQuery(GetAppActivityChart, {
    variables: {
      appId: id,
      period: TimeRange.Day,
    },
    fetchPolicy: 'cache-and-network',
  })

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

  return (
    <Card>
      <div className="rounded-xl p-8 flex flex-col w-full gap-8 justify-between">
        <div className="space-y-4">
          <div className="text-3xl font-semibold flex items-center gap-2">
            <FaCube
              size="28"
              className="text-neutral-800 dark:text-neutral-300 group-hover:text-emerald-500 transition-colors duration-300"
            />
            {name}
          </div>
          <div className="text-xs font-mono text-neutral-500 w-full break-all">{id}</div>
        </div>

        <div className="w-full min-h-[60px]">
          {!chartIsLoading && (
            <AreaSparklineChart
              height={60}
              data={chartData}
              series={
                <AreaSeries
                  colorScheme={'#10b981'}
                  tooltip={<TooltipArea disabled={true} />}
                  markLine={null}
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
                />
              }
            />
          )}
        </div>

        <div className="flex  justify-end items-center">
          <div>
            {chartIsLoading && <Spinner size="sm" />}
            {data && (
              <div className="flex gap-2 items-baseline">
                <span className="text-neutral-500 font-extralight ">app is live</span>
                <span
                  className="h-2 w-2 bg-emerald-500 animate-pulse rounded-full"
                  title="App is live"
                ></span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}
