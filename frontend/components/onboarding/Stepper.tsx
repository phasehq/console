import clsx from 'clsx'

export type Step = {
  index: number
  name: string
  icon: React.ReactNode
  title: string
  description: React.ReactNode
}

interface StepperProps {
  steps: Step[]
  activeStep: number
}

export const Stepper = (props: StepperProps) => {
  const ICON_WRAPPER_BASE =
    'rounded-full transition duration-500 ease-in-out h-10 w-10 py-3 border text-center flex justify-center items-center'
  const LABEL_BASE =
    'absolute top-0 -ml-10 text-center mt-16 w-32 text-2xs font-medium uppercase tracking-widest'
  const THREAD_BASE = 'flex-auto border-t transition duration-500 ease-in-out'

  const stepIsComplete = (step: Step) => {
    return step.index < props.activeStep
  }

  const stepIsActive = (step: Step) => {
    return step.index === props.activeStep
  }

  return (
    <div className="p-5 space-y-20">
      <div className="mx-4 p-4">
        <div className="flex items-center">
          {props.steps.map((step: Step, index: number) => (
            <>
              <div className="flex items-center text-emerald-500 relative">
                <div
                  className={clsx(
                    ICON_WRAPPER_BASE,
                    stepIsComplete(step) || stepIsActive(step)
                      ? 'border-emerald-500 text-emerald-500'
                      : 'border-zinc-500',
                    stepIsActive(step) && 'bg-emerald-400/20 text-black dark:text-white',
                    stepIsComplete(step) && 'text-emerald-500',
                    !stepIsActive(step) && !stepIsComplete(step) && 'text-zinc-500'
                  )}
                >
                  {step.icon}
                </div>
                <div
                  className={clsx(
                    LABEL_BASE,
                    stepIsComplete(step) || stepIsActive(step)
                      ? 'text-emerald-500'
                      : 'text-zinc-500'
                  )}
                >
                  {step.name}
                </div>
              </div>
              {index !== props.steps.length - 1 && (
                <div
                  className={clsx(
                    THREAD_BASE,
                    stepIsActive(props.steps[step.index + 1]) ||
                      stepIsComplete(props.steps[step.index + 1])
                      ? 'border-emerald-500'
                      : 'border-zinc-500'
                  )}
                ></div>
              )}
            </>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-3xl text-black dark:text-white font-bold text-center">
          {props.steps[props.activeStep].title}
        </div>
        <p className="text-black/30 dark:text-white/40 text-center text-lg">
          {props.steps[props.activeStep].description}
        </p>
      </div>
    </div>
  )
}
