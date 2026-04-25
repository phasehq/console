'use client'

import { Button } from '@/components/common/Button'
import { AccountPassword } from '@/components/onboarding/AccountPassword'
import { AccountSeedChecker } from '@/components/onboarding/AccountSeedChecker'
import { Step, Stepper } from '@/components/onboarding/Stepper'
import { useContext, useEffect, useState } from 'react'
import { FaEye, FaEyeSlash, FaShieldAlt } from 'react-icons/fa'
import { MdContentPaste, MdOutlineKey } from 'react-icons/md'
import { useMutation } from '@apollo/client'
import UpdateWrappedSecrets from '@/graphql/mutations/organisation/updateUserWrappedSecrets.gql'
import ResetAccountPasswordViaRecovery from '@/graphql/mutations/auth/resetAccountPasswordViaRecovery.gql'
import { useSession } from '@/contexts/userContext'
import { toast } from 'react-toastify'
import { useRouter } from 'next/navigation'
import UserMenu from '@/components/UserMenu'
import { organisationContext } from '@/contexts/organisationContext'
import { KeyringContext } from '@/contexts/keyringContext'
import { Avatar } from '@/components/common/Avatar'
import { RoleLabel } from '@/components/users/RoleLabel'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { setDeviceKey, setMemberDeviceKey } from '@/utils/localStorage'
import {
  organisationSeed,
  organisationKeyring,
  deviceVaultKey,
  passwordAuthHash,
  encryptAccountKeyring,
  encryptAccountRecovery,
} from '@/utils/crypto'
import { useUser } from '@/contexts/userContext'

export default function Recovery({ params }: { params: { team: string } }) {
  const { data: session } = useSession()
  const { user } = useUser()
  const [inputs, setInputs] = useState<Array<string>>([])
  const [pw, setPw] = useState<string>('')
  const [pw2, setPw2] = useState<string>('')
  const [savePassword, setSavePassword] = useState(true)
  const [showPw, setShowPw] = useState<boolean>(false)

  const [step, setStep] = useState<number>(0)

  const isPasswordUser = user?.authMethod === 'password'

  const steps: Step[] = [
    {
      index: 0,
      name: 'Recovery phrase',
      icon: <MdContentPaste />,
      title: 'Recovery phrase',
      description: 'Please enter the your account recovery phrase in the correct order below.',
    },
    {
      index: 1,
      name: isPasswordUser ? 'Account password' : 'Sudo password',
      icon: <MdOutlineKey />,
      title: isPasswordUser ? 'Account password' : 'Sudo password',
      description: isPasswordUser
        ? 'Enter your account password. This will be used to restore access to this account.'
        : "Please set up a strong 'sudo' password to continue. This will be used to encrypt keys and perform administrative tasks.",
    },
  ]

  const [updateWrappedSecrets] = useMutation(UpdateWrappedSecrets)
  const [resetAccountPasswordViaRecovery] = useMutation(ResetAccountPasswordViaRecovery)

  const router = useRouter()

  const { organisations } = useContext(organisationContext)

  const { setKeyring } = useContext(KeyringContext)

  const org = organisations?.find((org) => org.name === params.team) ?? null

  const handleInputUpdate = (newValue: string, index: number) => {
    if (newValue.split(' ').length === 24) {
      setInputs(newValue.split(' '))
    } else setInputs(inputs.map((input: string, i: number) => (index === i ? newValue : input)))
  }

  const handleAccountRecovery = async () => {
    // Yield once so the toast spinner paints before the (synchronous-feeling)
    // KDF + encryption work begins.
    await new Promise((r) => setTimeout(r, 50))

    const mnemonic = inputs.join(' ')

    const accountSeed = await organisationSeed(mnemonic, org?.id!)
    const accountKeyRing = await organisationKeyring(accountSeed)
    if (accountKeyRing.publicKey !== org?.identityKey) {
      throw new Error('Incorrect account recovery key')
    }

    const deviceKey = await deviceVaultKey(pw, session?.user?.email!)
    const encryptedKeyring = await encryptAccountKeyring(accountKeyRing, deviceKey)
    const encryptedMnemonic = await encryptAccountRecovery(mnemonic, deviceKey)

    // Password-auth users: verify the supplied password is the account
    // login password AND atomically rewrap this org's keyring server-side.
    // SSO users: just update the wrapped keyring (no login password).
    if (isPasswordUser) {
      const newAuthHash = await passwordAuthHash(pw, session?.user?.email!)
      await resetAccountPasswordViaRecovery({
        variables: {
          orgId: org!.id,
          newAuthHash,
          identityKey: accountKeyRing.publicKey,
          wrappedKeyring: encryptedKeyring,
          wrappedRecovery: encryptedMnemonic,
        },
      })
    } else {
      await updateWrappedSecrets({
        variables: {
          orgId: org!.id,
          identityKey: accountKeyRing.publicKey,
          wrappedKeyring: encryptedKeyring,
          wrappedRecovery: encryptedMnemonic,
        },
      })
    }

    setKeyring(accountKeyRing)

    if (savePassword) {
      if (isPasswordUser && user?.userId) {
        setDeviceKey(user.userId, deviceKey)
      } else if (org?.memberId) {
        setMemberDeviceKey(org.memberId, deviceKey)
      }
    }

    return {
      publicKey: accountKeyRing.publicKey,
      encryptedKeyring,
    }
  }

  const incrementStep = async (event: { preventDefault: () => void }) => {
    event.preventDefault()

    if (step !== steps.length - 1) setStep(step + 1)
    if (step === steps.length - 1) {
      if (!isPasswordUser && pw !== pw2) {
        toast.error("Passwords don't match")
        return false
      }
      toast
        .promise(handleAccountRecovery, {
          pending: 'Recovering your account...',
          success: 'Recovery complete!',
          error: {
            render({ data }: { data: any }) {
              return data?.message || 'Recovery failed. Please try again.'
            },
          },
        })
        .then(() => router.push(`/${org!.name}`))
        .catch(() => {})
    }
  }

  const decrementStep = () => {
    if (step !== 0) setStep(step - 1)
  }

  useEffect(() => {
    setInputs([...Array(24)].map(() => ''))
  }, [])

  return (
    <>
      <div className="flex flex-col justify-between w-full h-screen">
        <div className="w-full flex justify-end p-4">
          <UserMenu />
        </div>
        <div className="flex flex-col mx-auto my-auto w-full max-w-3xl gap-y-8">
          <div className="mx-auto max-w-xl">
            <h1 className="text-4xl text-black dark:text-white text-center font-bold">
              Account Recovery
            </h1>
            <p className="text-black/30 dark:text-white/40 text-center text-lg">
              This wizard will help you restore access to your Phase Account. Please enter your
              recovery phrase below, and then{' '}
              {isPasswordUser ? 'enter your account password' : 'set a new sudo password'}.
            </p>
          </div>
          <form
            onSubmit={incrementStep}
            className="space-y-8 p-8 border border-violet-200/10 rounded-lg dark:bg-black/30 backdrop-blur-lg w-full mx-auto shadow-lg"
          >
            {org && (
              <div className="flex items-center justify-between">
                <div className="whitespace-nowrap flex items-center gap-2">
                  <Avatar user={session?.user} size="md" />
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-black dark:text-white">
                        {session?.user?.name}
                      </span>
                      <span className="text-neutral-500 text-2xs">{session?.user?.email}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-black dark:text-white">{org.name}</h2>
                  <span className="text-neutral-500">
                    <RoleLabel role={org.role!} />
                  </span>
                </div>
              </div>
            )}

            <div className="flex flex-col w-full">
              <Stepper steps={steps} activeStep={step} />
            </div>

            {step === 0 && (
              <AccountSeedChecker
                mnemonic={''}
                inputs={inputs}
                updateInputs={handleInputUpdate}
                required={true}
              />
            )}

            {step === 1 &&
              (isPasswordUser ? (
                <div className="space-y-4 max-w-md mx-auto">
                  <div className="space-y-1">
                    <label
                      className="block text-gray-700 text-sm font-bold"
                      htmlFor="account-password"
                    >
                      Account password
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
                      <span className="text-neutral-500 text-sm">
                        Remember password on this device
                      </span>
                    </div>
                    <ToggleSwitch
                      value={savePassword}
                      onToggle={() => setSavePassword(!savePassword)}
                    />
                  </div>
                </div>
              ) : (
                <AccountPassword
                  pw={pw}
                  setPw={setPw}
                  pw2={pw2}
                  setPw2={setPw2}
                  savePassword={savePassword}
                  setSavePassword={setSavePassword}
                />
              ))}

            <div className="flex justify-between w-full">
              <div>
                {step !== 0 && (
                  <Button variant="secondary" onClick={decrementStep} type="button">
                    Previous
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="primary" type="submit">
                  Next
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
