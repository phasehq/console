import React, { useState } from 'react'
import { FaEye, FaEyeSlash, FaShieldAlt } from 'react-icons/fa'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { PasswordStrengthMeter } from '../common/PasswordStrengthMeter'

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

  return (
    <div className="space-y-4 max-w-md mx-auto">
      <div className="space-y-1">
        <label className="block text-neutral-500 text-xs" htmlFor="password">
          Password <span className="text-red-500">*</span>
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
            autoFocus
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
        <label className="block text-neutral-500 text-xs" htmlFor="confirmPassword">
          Confirm password <span className="text-red-500">*</span>
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

      <PasswordStrengthMeter password={pw} />

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
