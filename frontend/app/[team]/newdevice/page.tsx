'use client'

import { Button } from '@/components/common/Button'
import { AccountPassword } from '@/components/onboarding/AccountPassword'
import { AccountSeedChecker } from '@/components/onboarding/AccountSeedChecker'
import { Step, Stepper } from '@/components/onboarding/Stepper'
import { useEffect, useState } from 'react'
import { MdContentPaste, MdOutlineKey } from 'react-icons/md'
import { GetOrganisations } from '@/graphql/queries/getOrganisations.gql'
import { useQuery } from '@apollo/client'
import { OrganisationType } from '@/apollo/graphql'
import { cryptoUtils } from '@/utils/auth'
import { useSession } from 'next-auth/react'
import { toast } from 'react-toastify'
import { setLocalKeyring } from '@/utils/localStorage'
import { useRouter } from 'next/navigation'
import UserMenu from '@/components/UserMenu'

export default function NewDevice({ params }: { params: { team: string } }) {
  const { data: session } = useSession()
  const [inputs, setInputs] = useState<Array<string>>([])
  const [pw, setPw] = useState<string>('')
  const [pw2, setPw2] = useState<string>('')
  const [step, setStep] = useState<number>(0)
  const { loading, error, data } = useQuery(GetOrganisations)
  const router = useRouter()

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
        "Please set up a strong 'sudo' password to continue. This will be used to to perform administrative tasks and to encrypt keys locally on this device.",
    },
  ]

  const handleInputUpdate = (newValue: string, index: number) => {
    if (newValue.split(' ').length === 24) {
      setInputs(newValue.split(' '))
    } else setInputs(inputs.map((input: string, i: number) => (index === i ? newValue : input)))
  }

  const handleLocalAccountSetup = () => {
    return new Promise<{ publicKey: string; encryptedKeyring: string }>((resolve, reject) => {
      setTimeout(async () => {
        const mnemonic = inputs.join(' ')
        const orgs = data.organisations as OrganisationType[]
        const org = orgs.find((org) => org.name === params.team)
        const accountSeed = await cryptoUtils.organisationSeed(mnemonic, org?.id!)

        const accountKeyRing = await cryptoUtils.organisationKeyring(accountSeed)
        if (accountKeyRing.publicKey !== org?.identityKey) {
          toast.error('Incorrect account recovery key!')
          reject('Incorrect account recovery key')
        }

        const deviceKey = await cryptoUtils.deviceVaultKey(pw, session?.user?.email!)
        const encryptedKeyring = await cryptoUtils.encryptAccountKeyring(accountKeyRing, deviceKey)
        const encryptedMnemonic = await cryptoUtils.encryptAccountRecovery(mnemonic, deviceKey)
        setLocalKeyring({
          email: session?.user?.email!,
          org: org!,
          keyring: encryptedKeyring,
          recovery: encryptedMnemonic,
        })

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
              {
                "Looks like your signing in on a new browser or machine. You'll need to setup your account keys for this device before you can proceed."
              }
            </p>
          </div>
          <form
            onSubmit={incrementStep}
            className="space-y-16 p-8 border border-violet-200/10 rounded-lg dark:bg-black/30 backdrop-blur-lg w-full mx-auto shadow-lg"
          >
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
            {step === 1 && <AccountPassword pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} />}
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
