import { motion, MotionValue, useMotionTemplate, useMotionValue } from 'framer-motion'
import { GridPattern } from '@/components/common/GridPattern'
import { ReactNode } from 'react'

type Pattern = {
  y: number
  squares: number[][]
}

interface CardProps {
  pattern?: Pattern
  padding?: string
  children: ReactNode
}

interface CardPatternProps {
  mouseX: MotionValue<number>
  mouseY: MotionValue<number>
  squares: number[][]
}

function CardPattern({ mouseX, mouseY, squares }: CardPatternProps) {
  let maskImage = useMotionTemplate`radial-gradient(180px at ${mouseX}px ${mouseY}px, white, transparent)`
  let style = { maskImage, WebkitMaskImage: maskImage }

  return (
    <div className="pointer-events-none">
      <div className="absolute inset-0 rounded-2xl transition duration-300 [mask-image:linear-gradient(white,transparent)] group-hover:opacity-50">
        <GridPattern
          width={72}
          height={56}
          x="50%"
          y="50%"
          squares={squares}
          className="absolute inset-x-0 inset-y-[-30%] h-[160%] w-full skew-y-[-18deg] fill-black/[0.02] stroke-black/5 dark:fill-white/1 dark:stroke-white/2.5"
        />
      </div>
      <motion.div
        className="absolute inset-0 rounded-2xl bg-gradient-to-r from-[#D7EDEA] to-[#F4FBDF] opacity-0 transition duration-300 group-hover:opacity-100 dark:from-[#202D2E] dark:to-[#303428]"
        style={style}
      />
      <motion.div
        className="absolute inset-0 rounded-2xl opacity-0 mix-blend-overlay transition duration-300 group-hover:opacity-100"
        style={style}
      >
        <GridPattern
          width={72}
          height={56}
          x="50%"
          y="50%"
          squares={squares}
          className="absolute inset-x-0 inset-y-[-30%] h-[160%] w-full skew-y-[-18deg] fill-black/50 stroke-black/70 dark:fill-white/2.5 dark:stroke-white/10"
        />
      </motion.div>
    </div>
  )
}

export function Card({ pattern, padding = 'p-4', children }: CardProps) {
  let mouseX = useMotionValue(0)
  let mouseY = useMotionValue(0)

  function onMouseMove(event: React.MouseEvent<HTMLElement>) {
    const { currentTarget, clientX, clientY } = event
    let { left, top } = currentTarget!.getBoundingClientRect()
    mouseX.set(clientX - left)
    mouseY.set(clientY - top)
  }

  const defaultPattern = {
    y: -6,
    squares: [
      [4, 3],
      [2, 1],
      [7, 3],
      [10, 6],
    ],
  }

  return (
    <div
      onMouseMove={onMouseMove}
      className="group relative flex w-full h-full rounded-2xl bg-zinc-100 ring-1 ring-inset ring-neutral-500/20 transition-shadow hover:shadow-md hover:shadow-zinc-900/5 dark:bg-white/2.5 dark:hover:shadow-black/5"
    >
      <CardPattern squares={defaultPattern.squares} mouseX={mouseX} mouseY={mouseY} />
      <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-zinc-900/7.5 group-hover:ring-zinc-900/10 dark:ring-white/10 dark:group-hover:ring-white/20" />
      <div className={`${padding} relative rounded-2xl w-full`}>{children}</div>
    </div>
  )
}
