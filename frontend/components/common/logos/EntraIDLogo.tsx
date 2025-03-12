import React from 'react'

interface EntraIDLogoProps {
  className?: string
}

export const EntraIDLogo: React.FC<EntraIDLogoProps> = ({ className }) => {
  return (
    <svg 
      width="18" 
      height="18" 
      viewBox="0 0 18 18" 
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="m3.802,14.032c.388.242,1.033.511,1.715.511.621,0,1.198-.18,1.676-.487,0,0,.001,0,.002-.001l1.805-1.128v4.073c-.286,0-.574-.078-.824-.234l-4.374-2.734Z" fill="#225086"/>
      <path d="m7.853,1.507L.353,9.967c-.579.654-.428,1.642.323,2.111,0,0,2.776,1.735,3.126,1.954.388.242,1.033.511,1.715.511.621,0,1.198-.18,1.676-.487,0,0,.001,0,.002-.001l1.805-1.128-4.364-2.728,4.365-4.924V1s0,0,0,0c-.424,0-.847.169-1.147.507Z" fill="#6df"/>
      <polygon points="4.636 10.199 4.688 10.231 9 12.927 9.001 12.927 9.001 12.927 9.001 5.276 9 5.275 4.636 10.199" fill="#cbf8ff"/>
      <path d="m17.324,12.078c.751-.469.902-1.457.323-2.111l-4.921-5.551c-.397-.185-.842-.291-1.313-.291-.925,0-1.752.399-2.302,1.026l-.109.123h0s4.364,4.924,4.364,4.924h0s0,0,0,0l-4.365,2.728v4.073c.287,0,.573-.078.823-.234l7.5-4.688Z" fill="#074793"/>
      <path d="m9.001,1v4.275s.109-.123.109-.123c.55-.627,1.377-1.026,2.302-1.026.472,0,.916.107,1.313.291l-2.579-2.909c-.299-.338-.723-.507-1.146-.507Z" fill="#0294e4"/>
      <polygon points="13.365 10.199 13.365 10.199 13.365 10.199 9.001 5.276 9.001 12.926 13.365 10.199" fill="#96bcc2"/>
    </svg>
  )
} 