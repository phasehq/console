import { SecretTagType } from '@/apollo/graphql'
import { FaCircle } from 'react-icons/fa'

export const Tag = (props: { tag: SecretTagType }) => {
  const { name, color } = props.tag

  return (
    <div className="flex items-center rounded-full gap-1 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 text-base px-2">
      <div className="flex items-center justify-center h-4 w-4">
        <FaCircle className="text-sm" color={color} />
      </div>
      <span>{name}</span>
    </div>
  )
}
