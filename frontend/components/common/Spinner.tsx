import clsx from 'clsx'

const SIZES = {
  sm: 'border-2 h-4 w-4',
  md: 'border-3 h-6 w-6',
  lg: 'border-4 h-8 w-8',
  xl: 'border-6 h-12 w-12',
}

interface SpinnerProps {
  size: 'sm' | 'md' | 'lg' | 'xl'
}

export default function Spinner(props: SpinnerProps = { size: 'lg' }) {
  const { size } = props
  const BASE_STYLE =
    'inline-block animate-spin rounded-full border-4 border-solid border-emerald-500 border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]'
  return (
    <div className={clsx(BASE_STYLE, SIZES[size])} role="status">
      <span className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">
        Loading...
      </span>
    </div>
  )
}
