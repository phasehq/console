import { useEffect, useState } from 'react'
import { ZXCVBNResult } from 'zxcvbn'
import { FaEye, FaEyeSlash, FaInfo } from 'react-icons/fa'

interface AccountPasswordProps {
  pw: string
  pw2: string
  setPw: Function
  setPw2: Function
}

export const AccountPassword = (props: AccountPasswordProps) => {
  const { pw, setPw, pw2, setPw2 } = props
  const [showPw, setShowPw] = useState<boolean>(false)
  const [showPw2, setShowPw2] = useState<boolean>(false)
  const [pwStrength, setPwStrength] = useState<ZXCVBNResult>({} as ZXCVBNResult)

  useEffect(() => {
    const zxcvbn = require('zxcvbn')
    const strength = zxcvbn(pw)
    setPwStrength(strength)
  }, [pw, setPwStrength])

  /**
   * Returns a color name based on the current password stength score
   *
   * @returns {string}
   */
  const pwStrengthColor = (): string => {
    let color = 'red'
    if (!pw) return color
    switch (pwStrength.score) {
      case 1:
        color = 'orange'
        break
      case 2:
        color = 'yellow'
        break
      case 3:
        color = 'blue'
        break
      case 4:
        color = 'green'
        break
      default:
        color = 'red'
        break
    }

    return color
  }

  const pwStrengthPercent = (): string => {
    let score = '0%'
    if (pw) score = `${(pwStrength.score / 4) * 100}%`
    return score
  }

  return (
    <div className="flex flex-col gap-4 max-w-md mx-auto">
      <label className="block text-gray-700 text-sm font-bold" htmlFor="password">
        Password
      </label>
      <div className="relative">
        <input
          id="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          type={showPw ? 'text' : 'password'}
          minLength={16}
          required
          className="w-full "
        />
        <button
          className="absolute inset-y-0 right-4"
          type="button"
          onClick={() => setShowPw(!showPw)}
          tabIndex={-1}
        >
          {showPw ? <FaEyeSlash /> : <FaEye />}
        </button>
      </div>
      <label className="block text-gray-700 text-sm font-bold" htmlFor="confirmPassword">
        Confirm password
      </label>
      <div className="relative">
        <input
          id="confirmPassword"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          type={showPw2 ? 'text' : 'password'}
          minLength={16}
          required
          className="w-full"
        />
        <button
          className="absolute inset-y-0 right-4"
          type="button"
          onClick={() => setShowPw2(!showPw2)}
          tabIndex={-1}
        >
          {showPw2 ? <FaEyeSlash /> : <FaEye />}
        </button>
      </div>
      <div className="mb-6 h-1 w-full bg-neutral-200 dark:bg-neutral-600">
        <div
          className="h-1 w-full ml-0 transition-all ease-in-out float-left"
          style={{
            transform: `scale(${pwStrengthPercent()}, 1)`,
            backgroundColor: pwStrengthColor(),
          }}
        ></div>
        {pwStrength.feedback && (
          <div className="flex w-full items-center gap-4 p-3 bg-white dark:bg-zinc-800 dark:bg-opacity-60 rounded-md text-black/50 dark:text-white/50">
            <FaInfo />
            {pwStrength.feedback.suggestions}
          </div>
        )}
      </div>
    </div>
  )
}
