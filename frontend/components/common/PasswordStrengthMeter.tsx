'use client'

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { FaCheck, FaInfo } from 'react-icons/fa'
import type { ZXCVBNResult } from 'zxcvbn'

interface PasswordStrengthMeterProps {
  password: string
}

const SCORE_COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-yellow-500',
  'bg-blue-500',
  'bg-emerald-500',
]

export const PasswordStrengthMeter = ({ password }: PasswordStrengthMeterProps) => {
  const [strength, setStrength] = useState<ZXCVBNResult>({} as ZXCVBNResult)

  useEffect(() => {
    const zxcvbn = require('zxcvbn')
    setStrength(zxcvbn(password))
  }, [password])

  const score = strength.score ?? 0
  const color = password ? SCORE_COLORS[score] : SCORE_COLORS[0]
  const percent = password ? `${(score / 4) * 100}%` : '0%'

  const lengthOk = password.length >= 16
  const zxcvbnSuggestions = strength?.feedback?.suggestions ?? []
  const suggestions = lengthOk
    ? zxcvbnSuggestions
    : [`Use at least 16 characters (currently ${password.length})`, ...zxcvbnSuggestions]
  const isStrong = lengthOk && zxcvbnSuggestions.length === 0

  return (
    <div>
      <div className="h-0.5 w-full bg-neutral-300 dark:bg-neutral-600">
        <div
          className={clsx('h-0.5 w-full ml-0 transition-all ease float-left', color)}
          style={{ transform: `scaleX(${percent})`, transformOrigin: '0%' }}
        />
      </div>
      <div className="flex w-full items-start gap-3 p-2 bg-zinc-100 dark:bg-zinc-800 dark:bg-opacity-60 rounded-b-md text-black/50 dark:text-white/50 text-xs">
        <div className="mt-0.5 shrink-0">{isStrong ? <FaCheck /> : <FaInfo />}</div>
        <div className="flex-grow min-w-0 leading-tight">
          {isStrong ? (
            'Strong password'
          ) : (
            <ul className="list-disc pl-4 space-y-0.5">
              {suggestions.map((s, i) => (
                <li key={i} className="break-words">
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
