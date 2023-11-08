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
import { AccountRecovery } from '@/components/onboarding/AccountRecovery'
import { AccountSeedChecker } from '@/components/onboarding/AccountSeedChecker'
import { AccountPassword } from '@/components/onboarding/AccountPassword'
import { cryptoUtils } from '@/utils/auth'
import { useSession } from 'next-auth/react'
import { toast } from 'react-toastify'
import { gql, useMutation } from '@apollo/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CreateOrg } from '@/graphql/mutations/createOrganisation.gql'
import { setLocalKeyring } from '@/utils/localStorage'
import { generateRecoveryPdf } from '@/utils/recovery'

const bip39 = require('bip39')

const Onboard = () => {
  const { data: session } = useSession()
  const [teamName, setTeamName] = useState<string>('')
  const [pw, setPw] = useState<string>('')
  const [pw2, setPw2] = useState<string>('')
  const [mnemonic, setMnemonic] = useState('')
  const [orgId, setOrgId] = useState('')
  const [inputs, setInputs] = useState<Array<string>>([])
  const [step, setStep] = useState<number>(0)
  const [showWelcome, setShowWelcome] = useState<boolean>(true)
  const [createOrganisation, { data, loading, error }] = useMutation(CreateOrg)
  const [isloading, setIsLoading] = useState<boolean>(false)
  const [recoveryDownloaded, setRecoveryDownloaded] = useState<boolean>(false)
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
      name: 'Team Name',
      icon: <MdGroups />,
      title: 'Choose a name for your team',
      description: 'Your team name must be alphanumeric.',
    },
    {
      index: 1,
      name: 'Sudo Password',
      icon: <MdOutlinePassword />,
      title: 'Set a sudo password',
      description:
        'Please set up a strong sudo password. This will be used to encrypt your account keys. You will be need to enter this password to perform administrative tasks that require access to your account keys.',
    },
    {
      index: 2,
      name: 'Account recovery',
      icon: <MdKey />,
      title: 'Account Recovery',
      description:
        'Only you have access to your account keys. If you forget your sudo password, you will need to enter a recovery phrase to retrieve your keys and regain access to your account.',
    },
  ]

  const validateCurrentStep = () => {
    if (step === 0) {
      if (!teamName) {
        errorToast('Please enter a team name')
        //return false
      }
    } else if (step === 1) {
      if (pw !== pw2) {
        errorToast("Passwords don't match")
        return false
      }
    } else if (step === 2) {
      if (!recoveryDownloaded) {
        errorToast('Please download the your account recovery kit!')
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

  const handleDownloadRecoveryKit = async () => {
    toast
      .promise(
        generateRecoveryPdf(
          mnemonic,
          session?.user?.email!,
          teamName,
          session?.user?.name || undefined
        ),
        {
          pending: 'Generating recovery kit',
          success: 'Downloaded recovery kit',
        }
      )
      .then(() => setRecoveryDownloaded(true))
  }

  const handleAccountInit = async () => {
    return new Promise<boolean>(async (resolve, reject) => {
      setIsLoading(true)
      const { publicKey, encryptedKeyring, encryptedMnemonic } = await computeAccountKeys()

      try {
        const result = await createOrganisation({
          variables: {
            id: orgId,
            name: teamName,
            identityKey: publicKey,
            wrappedKeyring: encryptedKeyring,
            wrappedRecovery: encryptedMnemonic,
          },
        })
        const { data } = result
        const newOrg = data.createOrganisation.organisation
        setLocalKeyring({
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
            onClick={() => (window.location.href = `/${teamName}`)}
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

            {step === 0 && <TeamName name={teamName} setName={setTeamName} />}
            {step === 1 && <AccountPassword pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} />}
            {step === 2 && (
              <AccountRecovery mnemonic={mnemonic} onDownload={handleDownloadRecoveryKit} />
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
                <Button variant="primary" type="submit" isLoading={isloading || loading}>
                  {step === steps.length - 1 ? 'Finish' : 'Next'}
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
