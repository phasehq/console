'use client'

import { Button } from '@/components/common/Button'
import { AccountPassword } from '@/components/onboarding/AccountPassword'
import { AccountSeedChecker } from '@/components/onboarding/AccountSeedChecker'
import { Step, Stepper } from '@/components/onboarding/Stepper'
import { useContext, useEffect, useState } from 'react'
import { MdContentPaste, MdOutlineKey } from 'react-icons/md'
import { GetOrganisations } from '@/graphql/queries/getOrganisations.gql'
import { useMutation, useQuery } from '@apollo/client'
import { OrganisationType } from '@/apollo/graphql'
import UpdateWrappedSecrets from '@/graphql/mutations/organisation/updateUserWrappedSecrets.gql'
import { cryptoUtils } from '@/utils/auth'
import { useSession } from 'next-auth/react'
import { toast } from 'react-toastify'
import { setLocalKeyring } from '@/utils/localStorage'
import { useRouter } from 'next/navigation'
import UserMenu from '@/components/UserMenu'
import { organisationContext } from '@/contexts/organisationContext'
import { FaEye, FaEyeSlash, FaInfo } from 'react-icons/fa'
import { KeyringContext } from '@/contexts/keyringContext'

export default function NewDevice({ params }: { params: { team: string } }) {
  const { data: session } = useSession()
  const [inputs, setInputs] = useState<Array<string>>([])
  const [pw, setPw] = useState<string>('')
  const [pw2, setPw2] = useState<string>('')
  const [showPw, setShowPw] = useState<boolean>(false)
  const [step, setStep] = useState<number>(0)
  const [steps, setSteps] = useState<Step[]>([
    {
      index: 0,
      name: 'Sudo password',
      icon: <MdOutlineKey />,
      title: 'Sudo password',
      description:
        "Please set up a strong 'sudo' password to continue. This will be used to to perform administrative tasks and to encrypt keys locally on this device.",
    },
  ])

  const [updateWrappedSecrets] = useMutation(UpdateWrappedSecrets)

  const [recoveryRequired, setRecoveryRequired] = useState<boolean>(false)

  const router = useRouter()

  const { organisations } = useContext(organisationContext)

  const { setKeyring } = useContext(KeyringContext)

  const org = organisations?.find((org) => org.name === params.team) ?? null

  //const recoveryRequired = org?.keyring === null

  useEffect(() => {
    if (org) {
      setRecoveryRequired(org.keyring === null || org.keyring === '')
    }
  }, [org])

  useEffect(() => {
    if (recoveryRequired)
      setSteps([
        {
          index: 0,
          name: 'Recovery phrase',
          icon: <MdContentPaste />,
          title: 'Recovery phrase',
          description: 'Please enter the your account recovery phrase in the correct order below.',
        },
        {
          index: 1,
          name: 'Sudo password',
          icon: <MdOutlineKey />,
          title: 'Sudo password',
          description:
            "Please set up a strong 'sudo' password to continue. This will be used to to perform administrative tasks and to encrypt keys locally on this device.",
        },
      ])

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveryRequired])

  const handleInputUpdate = (newValue: string, index: number) => {
    if (newValue.split(' ').length === 24) {
      setInputs(newValue.split(' '))
    } else setInputs(inputs.map((input: string, i: number) => (index === i ? newValue : input)))
  }

  const handleLocalAccountSetup = () => {
    return new Promise<{ publicKey: string; encryptedKeyring: string }>((resolve, reject) => {
      setTimeout(async () => {
        if (recoveryRequired) {
          const mnemonic = inputs.join(' ')

          const accountSeed = await cryptoUtils.organisationSeed(mnemonic, org?.id!)

          const accountKeyRing = await cryptoUtils.organisationKeyring(accountSeed)
          if (accountKeyRing.publicKey !== org?.identityKey) {
            toast.error('Incorrect account recovery key!')
            reject('Incorrect account recovery key')
          }

          const deviceKey = await cryptoUtils.deviceVaultKey(pw, session?.user?.email!)
          const encryptedKeyring = await cryptoUtils.encryptAccountKeyring(
            accountKeyRing,
            deviceKey
          )
          const encryptedMnemonic = await cryptoUtils.encryptAccountRecovery(mnemonic, deviceKey)

          setKeyring(accountKeyRing)

          setLocalKeyring({
            email: session?.user?.email!,
            org: org!,
            keyring: encryptedKeyring,
            recovery: encryptedMnemonic,
          })

          await updateWrappedSecrets({
            variables: {
              orgId: org!.id,
              wrappedKeyring: encryptedKeyring,
              wrappedRecovery: encryptedMnemonic,
            },
          })

          resolve({
            publicKey: accountKeyRing.publicKey,
            encryptedKeyring,
          })
        } else {
          try {
            const encryptedKeyring = org!.keyring!
            const deviceKey = await cryptoUtils.deviceVaultKey(pw, session?.user?.email!)
            const accountKeyRing = await cryptoUtils.decryptAccountKeyring(
              encryptedKeyring,
              deviceKey
            )

            setKeyring(accountKeyRing)

            setLocalKeyring({
              email: session?.user?.email!,
              org: org!,
              keyring: encryptedKeyring,
              recovery: org?.recovery!,
            })

            resolve({
              publicKey: accountKeyRing.publicKey,
              encryptedKeyring,
            })
          } catch (error) {
            toast.error('Something went wrong! Please check your sudo password and try again')
            reject('Something went wrong! Please check your sudo password and try again')
          }
        }
      }, 1000)
    })
  }

  const incrementStep = async (event: { preventDefault: () => void }) => {
    event.preventDefault()

    if (step !== steps.length - 1 && recoveryRequired) setStep(step + 1)
    if (step === steps.length - 1) {
      if (recoveryRequired && pw !== pw2) {
        toast.error("Passwords don't match")
        return false
      }
      toast
        .promise(handleLocalAccountSetup, {
          pending: 'Setting up your new device',
          success: 'Setup complete!',
        })
        .then(() => router.push('/'))
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
              Welcome back
            </h1>
            <p className="text-black/30 dark:text-white/40 text-center">
              {recoveryRequired
                ? "Looks like you are signing in on a new browser or machine. You'll need to setup your account keys for this device before you can proceed."
                : 'Looks like you are signing in on a new browser or machine. Please enter your sudo password to setup your keyring on this device.'}
            </p>
          </div>
          <form
            onSubmit={incrementStep}
            className="space-y-16 p-8 border border-violet-200/10 rounded-lg dark:bg-black/30 backdrop-blur-lg w-full mx-auto shadow-lg"
          >
            {recoveryRequired && (
              <div className="flex flex-col w-full">
                <Stepper steps={steps} activeStep={step} />
              </div>
            )}

            {step === 0 && recoveryRequired && (
              <AccountSeedChecker
                mnemonic={''}
                inputs={inputs}
                updateInputs={handleInputUpdate}
                required={true}
              />
            )}

            {step === 1 && recoveryRequired && (
              <AccountPassword pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} />
            )}

            {!recoveryRequired && (
              <div className="flex items-center justify-between">
                <div className="space-y-1 w-full max-w-md mx-auto">
                  <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="password">
                    Sudo password
                  </label>
                  <div className="flex justify-between w-full bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40 roudned-md focus-within:ring-1 focus-within:ring-inset focus-within:ring-emerald-500 rounded-md p-px">
                    <input
                      id="password"
                      value={pw}
                      onChange={(e) => setPw(e.target.value)}
                      type={showPw ? 'text' : 'password'}
                      minLength={16}
                      required
                      autoFocus
                      className="custom w-full text-zinc-800 font-mono dark:text-white bg-zinc-100 dark:bg-zinc-800 rounded-md ph-no-capture"
                    />
                    <button
                      className="bg-zinc-100 dark:bg-zinc-800 px-4 text-neutral-500 rounded-md"
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      tabIndex={-1}
                    >
                      {showPw ? <FaEyeSlash /> : <FaEye />}
                    </button>
                  </div>
                  <div>
                    <button
                      className="text-sm text-neutral-500"
                      type="button"
                      onClick={() => setRecoveryRequired(true)}
                    >
                      Forgot password?
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="primary" type="submit">
                    Next
                  </Button>
                </div>
              </div>
            )}
            {recoveryRequired && (
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
            )}
          </form>
        </div>
      </div>
    </>
  )
}
