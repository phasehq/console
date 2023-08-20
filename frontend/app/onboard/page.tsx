'use client'

import { Button } from '@/components/common/Button'
import { HeroPattern } from '@/components/common/HeroPattern'
import { Step, Stepper } from '@/components/onboarding/Stepper'
import { useEffect, useState } from 'react'
import {
  MdOutlineVerifiedUser,
  MdGroups,
  MdOutlineKey,
  MdKey,
  MdOutlinePassword,
} from 'react-icons/md'
import { TeamName } from '@/components/onboarding/TeamName'
import { AccountSeedGen } from '@/components/onboarding/AccountSeedGen'
import { AccountSeedChecker } from '@/components/onboarding/AccountSeedChecker'
import { AccountPassword } from '@/components/onboarding/AccountPassword'
import { cryptoUtils } from '@/utils/auth'
import { useSession } from 'next-auth/react'
import { toast } from 'react-toastify'
import { gql, useMutation } from '@apollo/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CreateOrganisation } from '@/graphql/mutations/createOrganisation.gql'
import { setLocalOrg } from '@/utils/localStorage'

const bip39 = require('bip39')

const Onboard = () => {
  const { data: session } = useSession()
  const [name, setName] = useState<string>('')
  const [pw, setPw] = useState<string>('')
  const [pw2, setPw2] = useState<string>('')
  const [mnemonic, setMnemonic] = useState('')
  const [orgId, setOrgId] = useState('')
  const [inputs, setInputs] = useState<Array<string>>([])
  const [step, setStep] = useState<number>(0)
  const [showWelcome, setShowWelcome] = useState<boolean>(true)
  const [createOrganisation, { data, loading, error }] = useMutation(CreateOrganisation)
  const [isloading, setIsLoading] = useState<boolean>(false)
  const [seedDownloaded, setSeedDownloaded] = useState<boolean>(false)
  const [success, setSuccess] = useState<boolean>(false)
  const router = useRouter()

  const errorToast = (message: string) => {
    toast.error(message)
  }

  const handleInputUpdate = (newValue: string, index: number) => {
    if (newValue.split(' ').length === 24) {
      setInputs(newValue.split(' '))
    } else setInputs(inputs.map((input: string, i: number) => (index === i ? newValue : input)))
  }

  const steps: Step[] = [
    {
      index: 0,
      name: 'Team name',
      icon: <MdGroups />,
      title: 'Choose a name for your team',
      description: 'Your team name must be alphanumeric.',
    },
    {
      index: 1,
      name: 'Set up recovery phrase',
      icon: <MdKey />,
      title: 'Recovery',
      description:
        "This is your 24 word recovery phrase. It's used to secure your application keys. Only you have access to it. Please write it down and store it somewhere safe like a password manager. You will need to enter your recovery phrase when logging in from a new device.",
    },
    {
      index: 2,
      name: 'Verify recovery phrase',
      icon: <MdOutlineVerifiedUser />,
      title: 'Verify recovery phrase',
      description: 'Please enter the your recovery phrase in the correct order below.',
    },
    {
      index: 3,
      name: 'Sudo password',
      icon: <MdOutlinePassword />,
      title: 'Set a sudo password',
      description:
        'Please set up a strong sudo password to continue. This will be used to to perform administrative tasks and to encrypt keys locally on this device.',
    },
  ]

  const validateCurrentStep = () => {
    if (step === 0) {
      if (!name) {
        errorToast('Please enter a team name')
        //return false
      }
    } else if (step === 2) {
      if (inputs.join(' ') !== mnemonic && !seedDownloaded) {
        errorToast('Incorrect account recovery key!')
        return false // TODO: UNCOMMENT THIS!!
      }
    } else if (step === 3) {
      if (pw !== pw2) {
        errorToast("Passwords don't match")
        return false
      }
    }
    return true
  }

  const computeAccountKeys = () => {
    return new Promise<{ publicKey: string; encryptedKeyring: string; encryptedMnemonic: string }>(
      (resolve) => {
        setTimeout(async () => {
          const accountSeed = await cryptoUtils.organisationSeed(mnemonic, orgId)

          const accountKeyRing = await cryptoUtils.organisationKeyring(accountSeed)

          const deviceKey = await cryptoUtils.deviceVaultKey(pw, session?.user?.email!)

          const encryptedKeyring = await cryptoUtils.encryptAccountKeyring(
            accountKeyRing,
            deviceKey
          )

          const encryptedMnemonic = await cryptoUtils.encryptAccountRecovery(mnemonic, deviceKey)

          resolve({
            publicKey: accountKeyRing.publicKey,
            encryptedKeyring,
            encryptedMnemonic,
          })
        }, 1000)
      }
    )
  }

  const handleAccountInit = async () => {
    return new Promise<boolean>(async (resolve, reject) => {
      setIsLoading(true)
      const { publicKey, encryptedKeyring, encryptedMnemonic } = await computeAccountKeys()

      try {
        const result = await createOrganisation({
          variables: {
            id: orgId,
            name,
            identityKey: publicKey,
          },
        })
        const { data } = result
        const newOrg = data.createOrganisation.organisation
        setLocalOrg({
          email: session?.user?.email!,
          org: newOrg,
          keyring: encryptedKeyring,
          recovery: encryptedMnemonic,
        })
      } catch (e) {
        setIsLoading(false)
        reject()
      }

      setIsLoading(false)
      resolve(true)
    })
  }

  const incrementStep = async (event: { preventDefault: () => void }) => {
    event.preventDefault()

    const isFormValid = validateCurrentStep()
    if (step !== steps.length - 1 && isFormValid) setStep(step + 1)
    if (step === steps.length - 1 && isFormValid) {
      toast.promise(handleAccountInit, {
        pending: 'Setting up your account',
        success: 'Account setup complete!',
      })
    }
  }

  const decrementStep = () => {
    if (step !== 0) setStep(step - 1)
  }

  const skipSeedCheckerStep = () => {
    if (seedDownloaded) setStep(3)
  }

  useEffect(() => {
    setMnemonic(bip39.generateMnemonic(256))
    const id = crypto.randomUUID()
    setOrgId(id)
  }, [])

  useEffect(() => {
    if (data?.createOrganisation?.organisation) {
      setSuccess(true)
    }
  }, [data, router])

  useEffect(() => {
    setInputs([...Array(mnemonic.split(' ').length)].map(() => ''))
  }, [mnemonic])

  const WelcomePane = () => {
    return (
      <div className="flex flex-col gap-y-2 items-center">
        <h1 className="text-4xl text-black dark:text-white text-center font-bold">
          Welcome to Phase
        </h1>
        <p className="text-black/30 dark:text-white/40 text-center">
          Setting up your account will take just a few minutes
        </p>
        <div className="mx-auto pt-8">
          <Button variant="primary" onClick={() => setShowWelcome(false)}>
            Get started
          </Button>
        </div>
      </div>
    )
  }

  const SuccessPane = () => {
    return (
      <div className="flex flex-col gap-y-2 items-center">
        <h1 className="text-4xl text-black dark:text-white text-center font-bold">Success!</h1>
        <p className="text-black/30 dark:text-white/40 text-center">Your account is setup!</p>
        <div className="mx-auto pt-8">
          <Button
            variant="primary"
            arrow="right"
            onClick={() => (window.location.href = `/${name}`)}
          >
            Go to Console
          </Button>
        </div>
      </div>
    )
  }

  return (
    <main className="w-full flex flex-col justify-between h-screen">
      <HeroPattern />

      <div className="mx-auto my-auto w-full max-w-4xl flex flex-col gap-y-16 py-40">
        {showWelcome && <WelcomePane />}
        {!showWelcome && !success && (
          <form
            onSubmit={incrementStep}
            className="space-y-16 p-8 border border-violet-200/10 rounded-lg dark:bg-black/30 backdrop-blur-lg w-full mx-auto shadow-lg"
          >
            <div className="flex flex-col w-full">
              <Stepper steps={steps} activeStep={step} />
            </div>

            {step === 0 && <TeamName name={name} setName={setName} />}
            {step === 1 && <AccountSeedGen mnemonic={mnemonic} />}
            {step === 2 && (
              <AccountSeedChecker
                mnemonic={mnemonic}
                inputs={inputs}
                updateInputs={handleInputUpdate}
                required={!seedDownloaded}
              />
            )}
            {step === 3 && <AccountPassword pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} />}

            <div className="flex justify-between w-full">
              <div>
                {step !== 0 && (
                  <Button variant="secondary" onClick={decrementStep} type="button">
                    Previous
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {seedDownloaded && step === 2 && (
                  <Button variant="secondary" type="button" onClick={skipSeedCheckerStep}>
                    Skip
                  </Button>
                )}
                <Button variant="primary" type="submit" isLoading={isloading || loading}>
                  Next
                </Button>
              </div>
            </div>
          </form>
        )}
        {success && <SuccessPane />}
      </div>
    </main>
  )
}

export default Onboard
