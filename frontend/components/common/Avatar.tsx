import clsx from 'clsx'

export const Avatar = (props: { imagePath: string; size: 'sm' | 'md' | 'lg' | 'xl' }) => {
  const sizes = {
    sm: 'h-5 w-5',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
    xl: 'h-20 w-20',
  }

  const sizeStyle = sizes[props.size]

  return (
    <div
      className={clsx('mr-1 rounded-full bg-center bg-cover bg-no-repeat ring-white', sizeStyle)}
      style={{ backgroundImage: `url(${props.imagePath})` }}
    ></div>
  )
}
