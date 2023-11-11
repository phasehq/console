import { SecretTagType } from '@/apollo/graphql'

export const isTagSame = (tag1: SecretTagType, tag2: SecretTagType) => {
  return tag1.color === tag2.color && tag1.name === tag2.name
}

export const areTagsAreSame = (tags1: SecretTagType[], tags2: SecretTagType[]) => {
  if (tags1.length !== tags2.length) return false

  const sortedTags1 = [...tags1].sort((a, b) => a.id.localeCompare(b.id))
  const sortedTags2 = [...tags2].sort((a, b) => a.id.localeCompare(b.id))

  return sortedTags1.every((tag, index) => isTagSame(tag, sortedTags2[index]))
}
