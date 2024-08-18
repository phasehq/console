'use client'

import { Button } from '@/components/common/Button'
import { HeroPattern } from '@/components/common/HeroPattern'
import { Step, Stepper } from '@/components/onboarding/Stepper'
import { useEffect, useState } from 'react'
import { MdGroups, MdKey, MdOutlinePassword } from 'react-icons/md'
import { TeamName } from '@/components/onboarding/TeamName'
import { AccountRecovery } from '@/components/onboarding/AccountRecovery'
import { AccountPassword } from '@/components/onboarding/AccountPassword'
import { useSession } from 'next-auth/react'
import { toast } from 'react-toastify'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { useRouter } from 'next/navigation'
import { GetLicenseData } from '@/graphql/queries/organisation/getLicense.gql'
import { CreateOrg } from '@/graphql/mutations/createOrganisation.gql'
import GetOrganisations from '@/graphql/queries/getOrganisations.gql'
import CheckOrganisationNameAvailability from '@/graphql/queries/organisation/checkOrgNameAvailable.gql'
import { copyRecoveryKit, generateRecoveryPdf } from '@/utils/recovery'
import { setDevicePassword } from '@/utils/localStorage'
import { License } from '@/components/settings/organisation/License'
import { LogoMark } from '@/components/common/LogoMark'
import {
  organisationSeed,
  organisationKeyring,
  deviceVaultKey,
  encryptAccountKeyring,
  encryptAccountRecovery,
} from '@/utils/crypto'

const bip39 = require('bip39')

const Onboard = () => {
  const { data: session } = useSession()
  const [teamNameLock, setTeamNameLock] = useState(false)
  const [teamName, setTeamName] = useState<string>('')
  const [pw, setPw] = useState<string>('')
  const [pw2, setPw2] = useState<string>('')
  const [savePassword, setSavePassword] = useState(true)
  const [mnemonic, setMnemonic] = useState('')
  const [orgId, setOrgId] = useState('')
  const [inputs, setInputs] = useState<Array<string>>([])
  const [step, setStep] = useState<number>(0)

  const { data: licenseData } = useQuery(GetLicenseData)
  const [createOrganisation, { data, loading, error }] = useMutation(CreateOrg)
  const [checkOrganisationNameAvailability] = useLazyQuery(CheckOrganisationNameAvailability)
  const [isloading, setIsLoading] = useState<boolean>(false)
  const [recoveryDownloaded, setRecoveryDownloaded] = useState<boolean>(false)
  const [success, setSuccess] = useState<boolean>(false)

  const router = useRouter()

  const errorToast = (message: string) => {
    toast.error(message)
  }

  useEffect(() => {
    if (licenseData?.license?.organisationName) {
      setTeamName(licenseData.license.organisationName)
      setTeamNameLock(true)

      if (licenseData.license?.organisationOwner?.email === session?.user?.email) {
        router.push(`/`)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [licenseData])

  const licenseActivated = () => licenseData?.license?.isActivated

  const steps: Step[] = [
    {
      index: 0,
      name: teamNameLock ? 'Organisation setup' : 'Organisation Name',
      icon: <MdGroups />,
      title: teamNameLock ? 'Set up your organisation' : 'Choose a name for your organisation',
      description: teamNameLock ? (
        <></>
      ) : (
        <div className="space-y-1">
          Your organisation name can be alphanumeric.
          <code>
            <pre>[a-zA-Z0-9]</pre>
          </code>
        </div>
      ),
    },
    {
      index: 1,
      name: 'Sudo Password',
      icon: <MdOutlinePassword />,
      title: 'Set a sudo password',
      description:
        'This will be used to encrypt your account keys. You may need to enter this password to unlock your workspace when logging in.',
    },
    {
      index: 2,
      name: 'Account recovery',
      icon: <MdKey />,
      title: 'Account Recovery',
      description:
        'If you forget your sudo password, you will need to use a recovery kit to regain access to your account.',
    },
  ]

  const validateCurrentStep = async () => {
    if (step === 0) {
      if (!teamName) {
        errorToast('Please enter an organisation name')
        return false
      } else {
        const { data } = await checkOrganisationNameAvailability({ variables: { name: teamName } })
        if (!data.organisationNameAvailable) {
          errorToast('This organisation name is taken!')
          return false
        }
      }
      return true
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
          const accountSeed = await organisationSeed(mnemonic, orgId)

          const accountKeyRing = await organisationKeyring(accountSeed)

          const deviceKey = await deviceVaultKey(pw, session?.user?.email!)

          const encryptedKeyring = await encryptAccountKeyring(accountKeyRing, deviceKey)

          const encryptedMnemonic = await encryptAccountRecovery(mnemonic, deviceKey)

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

  const handleCopyRecoveryKit = () => {
    copyRecoveryKit(mnemonic, session?.user?.email!, teamName, session?.user?.name || undefined)
    setRecoveryDownloaded(true)
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
          refetchQueries: [{ query: GetOrganisations }],
        })
        const { data } = result
        const newOrg = data.createOrganisation.organisation
        if (savePassword) {
          setDevicePassword(newOrg.memberId, pw)
        }
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

    const isFormValid = await validateCurrentStep()
    if (step !== steps.length - 1 && isFormValid) setStep(step + 1)
    if (step === steps.length - 1 && isFormValid) {
      toast
        .promise(handleAccountInit, {
          pending: 'Setting up your account',
          success: 'Account setup complete!',
        })
        .then(() => {
          router.push(`/${teamName}`)
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

  const SuccessPane = () => {
    return (
      <div className="flex flex-col gap-y-2 items-center">
        <h1 className="text-4xl text-black dark:text-white text-center font-bold">
          You&apos;re All Set
        </h1>
        <p className="text-black/30 dark:text-white/40 text-center">Your account is ready to go!</p>
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

      {!licenseActivated() ? (
        <div className="mx-auto my-auto w-full max-w-4xl flex flex-col gap-y-16 py-40">
          {success ? (
            <SuccessPane />
          ) : (
            <form
              onSubmit={incrementStep}
              className="space-y-8 p-8 border border-violet-200/10 rounded-lg bg-zinc-100 dark:bg-black/30 backdrop-blur-lg w-full mx-auto shadow-lg"
            >
              <div className="flex flex-col w-full">
                {step >= 0 && (
                  <div className="text-black dark:text-white font-semibold text-2xl text-center">
                    Welcome to Phase
                  </div>
                )}
                <Stepper steps={steps} activeStep={step} />
              </div>

              {licenseData?.license && <License license={licenseData.license} showExpiry={false} />}

              {step === 0 && (
                <TeamName name={teamName} setName={setTeamName} isLocked={teamNameLock} />
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
              {step === 2 && (
                <AccountRecovery
                  mnemonic={mnemonic}
                  onDownload={handleDownloadRecoveryKit}
                  onCopy={handleCopyRecoveryKit}
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
                  <Button
                    variant="primary"
                    type="submit"
                    isLoading={isloading || loading}
                    disabled={step === steps.length - 1 && !recoveryDownloaded}
                  >
                    {step === steps.length - 1 ? 'Finish' : 'Next'}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </div>
      ) : (
        <div className="mx-auto my-auto w-full max-w-3xl flex flex-col gap-8 p-16 rounded-lg text-center items-center bg-zinc-200 dark:bg-zinc-800/40 ring-1 ring-inset ring-neutral-500/40 shadow-xl">
          <LogoMark className="w-32 fill-black dark:fill-white" />

          <div className="space-y-1">
            <div className="text-black dark:text-white font-semibold text-3xl text-center">
              Welcome to Phase at {licenseData.license.customerName}
            </div>
            <p className="text-neutral-500 text-lg">
              Your organisation admin has already set up this Phase instance.
            </p>
            <p className="text-neutral-500 text-lg">
              Please contact{' '}
              <a href={`mailto:${licenseData.license.organisationOwner.email}`}>
                <span className="text-emerald-400 font-medium">
                  {licenseData.license.organisationOwner.fullName}
                </span>{' '}
                ({licenseData.license.organisationOwner.email}){' '}
              </a>
              for an invite to join this workspace.
            </p>
          </div>
        </div>
      )}
    </main>
  )
}

export default Onboard
