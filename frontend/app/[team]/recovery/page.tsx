'use client'

import { Button } from '@/components/common/Button'
import { AccountPassword } from '@/components/onboarding/AccountPassword'
import { AccountSeedChecker } from '@/components/onboarding/AccountSeedChecker'
import { Step, Stepper } from '@/components/onboarding/Stepper'
import { useContext, useEffect, useState } from 'react'
import { MdContentPaste, MdOutlineKey } from 'react-icons/md'
import { useMutation } from '@apollo/client'
import UpdateWrappedSecrets from '@/graphql/mutations/organisation/updateUserWrappedSecrets.gql'
import { useSession } from 'next-auth/react'
import { toast } from 'react-toastify'
import { useRouter } from 'next/navigation'
import UserMenu from '@/components/UserMenu'
import { organisationContext } from '@/contexts/organisationContext'
import { KeyringContext } from '@/contexts/keyringContext'
import { Avatar } from '@/components/common/Avatar'
import { RoleLabel } from '@/components/users/RoleLabel'
import { setDevicePassword } from '@/utils/localStorage'
import {
  organisationSeed,
  organisationKeyring,
  deviceVaultKey,
  encryptAccountKeyring,
  encryptAccountRecovery,
} from '@/utils/crypto'

export default function Recovery({ params }: { params: { team: string } }) {
  const { data: session } = useSession()
  const [inputs, setInputs] = useState<Array<string>>([])
  const [pw, setPw] = useState<string>('')
  const [pw2, setPw2] = useState<string>('')
  const [savePassword, setSavePassword] = useState(true)

  const [step, setStep] = useState<number>(0)

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
      name: 'Sudo password',
      icon: <MdOutlineKey />,
      title: 'Sudo password',
      description:
        "Please set up a strong 'sudo' password to continue. This will be used to encrypt keys and perform administrative tasks.",
    },
  ]

  const [updateWrappedSecrets] = useMutation(UpdateWrappedSecrets)

  const router = useRouter()

  const { organisations } = useContext(organisationContext)

  const { setKeyring } = useContext(KeyringContext)

  const org = organisations?.find((org) => org.name === params.team) ?? null

  const handleInputUpdate = (newValue: string, index: number) => {
    if (newValue.split(' ').length === 24) {
      setInputs(newValue.split(' '))
    } else setInputs(inputs.map((input: string, i: number) => (index === i ? newValue : input)))
  }

  const handleAccountRecovery = () => {
    return new Promise<{ publicKey: string; encryptedKeyring: string }>((resolve, reject) => {
      setTimeout(async () => {
        const mnemonic = inputs.join(' ')

        const accountSeed = await organisationSeed(mnemonic, org?.id!)

        const accountKeyRing = await organisationKeyring(accountSeed)
        if (accountKeyRing.publicKey !== org?.identityKey) {
          toast.error('Incorrect account recovery key!')
          reject('Incorrect account recovery key')
          return;
        }

        const deviceKey = await deviceVaultKey(pw, session?.user?.email!)
        const encryptedKeyring = await encryptAccountKeyring(accountKeyRing, deviceKey)
        const encryptedMnemonic = await encryptAccountRecovery(mnemonic, deviceKey)

        setKeyring(accountKeyRing)

        await updateWrappedSecrets({
          variables: {
            orgId: org!.id,
            wrappedKeyring: encryptedKeyring,
            wrappedRecovery: encryptedMnemonic,
          },
        })

        if (savePassword) {
          setDevicePassword(org?.memberId!, pw)
        }

        resolve({
          publicKey: accountKeyRing.publicKey,
          encryptedKeyring,
        })
      }, 1000)
    })
  }

  const incrementStep = async (event: { preventDefault: () => void }) => {
    event.preventDefault()

    if (step !== steps.length - 1) setStep(step + 1)
    if (step === steps.length - 1) {
      if (pw !== pw2) {
        toast.error("Passwords don't match")
        return false
      }
      toast
        .promise(handleAccountRecovery, {
          pending: 'Recovering your account...',
          success: 'Recovery complete!',
        })
        .then(() => router.push(`/${org!.name}`))
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
              recovery phrase below, and then set a new sudo password.
            </p>
          </div>
          <form
            onSubmit={incrementStep}
            className="space-y-8 p-8 border border-violet-200/10 rounded-lg dark:bg-black/30 backdrop-blur-lg w-full mx-auto shadow-lg"
          >
            {org && (
              <div className="flex items-center justify-between">
                <div className="whitespace-nowrap flex items-center gap-2">
                  <Avatar imagePath={session?.user?.image!} size="md" />
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
                  <h2 className="text-xl font-semibold text-black dark:text-white">{org.name}</h2>
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

            {step === 1 && (
              <AccountPassword
                pw={pw}
                setPw={setPw}
                pw2={pw2}
                setPw2={setPw2}
                savePassword={savePassword}
                setSavePassword={setSavePassword}
              />
            )}

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
