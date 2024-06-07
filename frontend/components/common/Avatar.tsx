import clsx from 'clsx'
import { FaUserLarge } from 'react-icons/fa6'

export const Avatar = (props: {
  imagePath: string | null | undefined
  size: 'sm' | 'md' | 'lg' | 'xl'
}) => {
  const sizes = {
    sm: 'h-5 w-5',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
    xl: 'h-20 w-20',
  }

  const sizeStyle = sizes[props.size]

  return (
    <div
      className={clsx(
        'mr-1 rounded-full bg-center bg-cover bg-no-repeat ring-1 ring-inset ring-neutral-500/40 flex items-center justify-center p-1',
        sizeStyle
      )}
      style={{ backgroundImage: `url(${props.imagePath})` }}
    >
      {!props.imagePath && <FaUserLarge className="text-neutral-500" />}
    </div>
  )
}
