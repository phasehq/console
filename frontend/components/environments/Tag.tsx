import { SecretTagType } from '@/apollo/graphql'
import { FaCircle } from 'react-icons/fa'
import clsx from 'clsx'

interface TagProps {
  tag: SecretTagType
  buttonVariant?: 'normal' | 'deleted' | 'added'
}

export const Tag = ({ tag, buttonVariant = 'normal' }: TagProps) => {
  const { name, color } = tag
  const variantStyles = {
    normal: "text-zinc-700 dark:text-zinc-200",
    deleted: "bg-red-200 dark:bg-red-950 text-red-500 ph-no-capture line-through rounded-full",
    added: "bg-emerald-100 dark:bg-emerald-950 text-emerald-500 ph-no-capture rounded-full",
  }

  const appliedVariantStyle = variantStyles[buttonVariant]  

  return (
    <div className={clsx("flex items-center rounded-full gap-1 border border-zinc-300 dark:border-zinc-700 text-base px-2", appliedVariantStyle)}>
      <div className="flex items-center justify-center h-4 w-4">
        <FaCircle className="text-sm" color={color} />
      </div>
      <span>{name}</span>
    </div>
  )
}
