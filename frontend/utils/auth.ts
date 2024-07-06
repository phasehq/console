import _sodium from 'libsodium-wrappers-sumo'

export namespace UrlUtils {
  export const makeUrl = (...endpoints: string[]) => {
    let url = endpoints.reduce((prevUrl, currentPath) => {
      if (prevUrl.length === 0) {
        return prevUrl + currentPath
      }

      return prevUrl.endsWith('/') ? prevUrl + currentPath + '/' : prevUrl + '/' + currentPath + '/'
    }, '')
    return url
  }
}
