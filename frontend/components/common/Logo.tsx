'use client'

interface LogoProps {
  boxSize: number
}

export const Logo = (props: LogoProps) => {
  const { boxSize } = props

  return (
    <svg
      width={boxSize}
      height={boxSize}
      viewBox="0 0 256 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="active"
    >
      <path
        d="M22 146.495C85.6927 18.9856 85.313 24.9378 116.746 147.947C149.419 269.955 204 155.947 204 147.947"
        stroke="white"
        strokeOpacity="0.2"
        strokeWidth="4"
        className="svg-elem-1 invert dark:invert-0"
      ></path>
      <path
        d="M36 147.947C99.6927 20.4374 100.313 24.9377 131.746 147.947C164.419 269.955 219 155.947 219 147.947"
        stroke="white"
        strokeOpacity="0.5"
        strokeWidth="4"
        className="svg-elem-2 invert dark:invert-0"
      ></path>
      <path
        d="M20 146.995C23.5834 146.995 165.493 146.995 236 146.995"
        stroke="white"
        strokeWidth="4"
        className="svg-elem-3 invert dark:invert-0"
      ></path>
      <path
        d="M52 145.995C115.693 18.4856 115.313 24.9377 146.746 147.947C179.419 269.955 234 155.947 234 147.947"
        stroke="#F2FF26"
        strokeWidth="4"
        className="svg-elem-4"
      ></path>
      <line
        x1="48"
        y1="145.995"
        x2="57"
        y2="145.995"
        stroke="white"
        strokeWidth="2"
        className="svg-elem-5 invert dark:invert-0"
      ></line>
      <line
        x1="228"
        y1="147.995"
        x2="236"
        y2="147.995"
        stroke="white"
        strokeWidth="2"
        className="svg-elem-6 invert dark:invert-0"
      ></line>
    </svg>
  )
}
