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
  align?: 'center' | 'left'
}

export const Stepper = ({ steps, activeStep, align = 'center' }: StepperProps) => {
  const ICON_WRAPPER_BASE =
    'rounded-full transition duration-500 ease-in-out h-10 w-10 py-3 border text-center flex justify-center items-center'
  const LABEL_BASE =
    'absolute top-0 -ml-10 text-center mt-16 w-32 text-2xs font-medium uppercase tracking-widest'
  const THREAD_BASE = 'flex-auto border-t transition duration-500 ease-in-out'

  const stepIsComplete = (step: Step) => {
    return step.index < activeStep
  }

  const stepIsActive = (step: Step) => {
    return step.index === activeStep
  }

  return (
    <div className="space-y-16">
      <div className="mx-4 p-4">
        <div className="flex items-center">
          {steps.map((step: Step, index: number) => (
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
              {index !== steps.length - 1 && (
                <div
                  className={clsx(
                    THREAD_BASE,
                    stepIsActive(steps[step.index + 1]) || stepIsComplete(steps[step.index + 1])
                      ? 'border-emerald-500'
                      : 'border-zinc-500'
                  )}
                ></div>
              )}
            </>
          ))}
        </div>
      </div>
      <div
        className={clsx(
          'border-b border-neutral-500/40 pb-2',
          align === 'center' && 'text-center px-4'
        )}
      >
        <div className="text-xl text-zinc-900 dark:text-zinc-100 font-semibold">
          {steps[activeStep].title}
        </div>
        <div className="text-neutral-500  text-sm">{steps[activeStep].description}</div>
      </div>
    </div>
  )
}
