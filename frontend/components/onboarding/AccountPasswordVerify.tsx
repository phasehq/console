import React, { useState } from 'react'
import { FaEye, FaEyeSlash, FaShieldAlt } from 'react-icons/fa'
import { ToggleSwitch } from '../common/ToggleSwitch'

interface AccountPasswordVerifyProps {
  pw: string
  setPw: (value: string) => void
  savePassword: boolean
  setSavePassword: (value: boolean) => void
  label?: string
}

export const AccountPasswordVerify = (props: AccountPasswordVerifyProps) => {
  const { pw, setPw, savePassword, setSavePassword, label } = props
  const [showPw, setShowPw] = useState<boolean>(false)

  return (
    <div className="space-y-4 max-w-md mx-auto">
      <div className="space-y-1">
        <label className="block text-neutral-500 text-xs" htmlFor="account-password">
          {label ?? 'Account password'} <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <input
            id="account-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            type={showPw ? 'text' : 'password'}
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
