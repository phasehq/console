import React, { useEffect, useState } from 'react'
import { ZXCVBNResult } from 'zxcvbn'
import { FaCheck, FaEye, FaEyeSlash, FaInfo, FaShieldAlt } from 'react-icons/fa'
import clsx from 'clsx'
import { ToggleSwitch } from '../common/ToggleSwitch'

interface AccountPasswordProps {
  pw: string
  pw2: string
  savePassword: boolean
  setPw: Function
  setPw2: Function
  setSavePassword: Function
}

export const AccountPassword = (props: AccountPasswordProps) => {
  const { pw, setPw, pw2, setPw2, savePassword, setSavePassword } = props
  const [showPw, setShowPw] = useState<boolean>(false)
  const [showPw2, setShowPw2] = useState<boolean>(false)
  const [pwStrength, setPwStrength] = useState<ZXCVBNResult>({} as ZXCVBNResult)

  useEffect(() => {
    const zxcvbn = require('zxcvbn')
    const strength = zxcvbn(pw)
    setPwStrength(strength)
  }, [pw])

  /**
   * Returns a color name based on the current password strength score
   *
   * @returns {string}
   */
  const pwStrengthColor = (): string => {
    let color = 'bg-red-500'
    if (!pw) return color
    switch (pwStrength.score) {
      case 1:
        color = 'bg-orange-500'
        break
      case 2:
        color = 'bg-yellow-500'
        break
      case 3:
        color = 'bg-blue-500'
        break
      case 4:
        color = 'bg-emerald-500'
        break
      default:
        color = 'bg-red-500'
        break
    }
    return color
  }

  const pwStrengthPercent = (): string => {
    return pw ? `${(pwStrength.score / 4) * 100}%` : '0%'
  }

  const passwordIsStrong = pwStrength?.feedback?.suggestions?.length === 0

  return (
    <div className="space-y-4 max-w-md mx-auto">
      <div className="space-y-1">
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
            className="w-full ph-no-capture"
          />
          <button
            className="absolute inset-y-0 right-4 text-neutral-500"
            type="button"
            onClick={() => setShowPw(!showPw)}
            tabIndex={-1}
          >
            {showPw ? <FaEyeSlash /> : <FaEye />}
          </button>
        </div>
      </div>

      <div className="space-y-1">
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
            className="w-full ph-no-capture"
          />
          <button
            className="absolute inset-y-0 right-4 text-neutral-500"
            type="button"
            onClick={() => setShowPw2(!showPw2)}
            tabIndex={-1}
          >
            {showPw2 ? <FaEyeSlash /> : <FaEye />}
          </button>
        </div>
      </div>

      <div>
        <div className={clsx('h-1 w-full bg-neutral-300 dark:bg-neutral-600 text-sm')}>
          <div
            className={clsx('h-1 w-full ml-0 transition-all ease float-left', pwStrengthColor())}
            style={{
              transform: `scaleX(${pwStrengthPercent()})`,
              transformOrigin: '0%',
            }}
          ></div>
        </div>
        <div className="flex w-full items-start gap-6 p-3 bg-zinc-200 dark:bg-zinc-800 dark:bg-opacity-60 rounded-b-md text-black/50 dark:text-white/50 text-sm">
          <div className="mt-1">
            {passwordIsStrong ? <FaCheck /> : <FaInfo />}
          </div>
          <div className="flex-grow">
            {passwordIsStrong ? (
              'Strong password'
            ) : (
              <ul className="list-disc pl-4">
                {pwStrength?.feedback?.suggestions?.map((suggestion, index) => (
                  <li key={index}>{suggestion}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 py-2">
        <div className="flex items-center gap-2">
          <FaShieldAlt className="text-emerald-500" />
          <span className="text-neutral-500 text-sm">Remember password on this device</span>
        </div>
        <ToggleSwitch value={savePassword} onToggle={() => setSavePassword(!savePassword)} />
      </div>
    </div>
  )
}
