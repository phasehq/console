import jsPDF from 'jspdf'
import { toast } from 'react-toastify'
import { copyToClipBoard } from './clipboard'
import { PHASE_LOGO } from './logo_b64'

export const generateRecoveryPdf = async (
  mnemonic: string,
  email: string,
  organisation: string,
  name?: string
) => {
  const title = 'Phase Recovery Kit'
  const subtitle = `This is a recovery kit for your Phase account. \nYou can use this to recover your account keys if you forget your sudo password.`
  const hostname = `${window.location.protocol}//${window.location.host}`

  // Create a new jsPDF instance
  const pdf = new jsPDF()

  // Draw the black rectangle for the header
  pdf.setFillColor(0, 0, 0)
  pdf.rect(0, 0, pdf.internal.pageSize.getWidth(), 60, 'F')

  // Set the title
  pdf.setTextColor(255, 255, 255)
  pdf.setFontSize(20)
  pdf.setFont('helvetica', 'bold')
  pdf.text(title, 10, 25)

  // Set the subtitle
  pdf.setTextColor(115, 115, 115)
  pdf.setFont('helvetica', 'regular', '400')
  pdf.setFontSize(11)
  pdf.text(subtitle, 10, 35)

  // Add the logo
  const imgProps = pdf.getImageProperties(PHASE_LOGO)
  const imgWidth = 30
  const imgHeight = (imgProps.height * imgWidth) / imgProps.width // scale the height to maintain aspect ratio
  const pageWidth = pdf.internal.pageSize.getWidth()
  pdf.addImage(PHASE_LOGO, 'PNG', pageWidth - imgWidth - 10, 10, imgWidth, imgHeight)

  const lineSpace = 6
  const paragraphSpace = 12

  // Define cursor x and y starting positions
  let xPosition = 10
  let yPosition = 80

  //Name
  if (name) {
    pdf.setTextColor(115, 115, 115)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(11)
    pdf.text('Name', xPosition, yPosition)
    yPosition += lineSpace

    pdf.setTextColor(23, 23, 23)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.text(name, xPosition, yPosition)
    yPosition += paragraphSpace
  }

  //Email
  pdf.setTextColor(115, 115, 115)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)
  pdf.text('Email', xPosition, yPosition)
  yPosition += lineSpace

  pdf.setTextColor(23, 23, 23)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text(email, xPosition, yPosition)
  yPosition += paragraphSpace

  //Org
  pdf.setTextColor(115, 115, 115)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)
  pdf.text('Organisation', xPosition, yPosition)
  yPosition += lineSpace

  pdf.setTextColor(23, 23, 23)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text(organisation, xPosition, yPosition)
  yPosition += paragraphSpace

  //Phase instance host
  pdf.setTextColor(115, 115, 115)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)
  pdf.text('Login URL', xPosition, yPosition)
  yPosition += lineSpace

  pdf.setTextColor(23, 23, 23)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text(hostname, xPosition, yPosition)
  yPosition += paragraphSpace * 2

  //Mnemonic
  pdf.setTextColor(115, 115, 115)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)
  pdf.text('Recovery phrase', xPosition, yPosition)
  yPosition += lineSpace

  // Define the size of the grid cells
  const cellWidth = pdf.internal.pageSize.getWidth() / 4
  const cellHeight = 10

  // Split the mnemonic into words
  const words = mnemonic.split(' ')

  // Loop over each word and place it in the PDF
  words.forEach((word, index) => {
    // Add the word number before the word
    pdf.setFontSize(14)
    pdf.setTextColor(23, 23, 23)
    pdf.setFont('helvetica', 'bold')
    pdf.text(word, xPosition, yPosition)

    // Increment the x position to the next column
    xPosition += cellWidth

    // If we've reached the end of a row, reset x and increment y
    if ((index + 1) % 4 === 0) {
      xPosition = 10
      yPosition += cellHeight
    }
  })

  yPosition += 10
  pdf.setTextColor(23, 23, 23)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.text(`Generated on ${new Date().toDateString()}`, 10, 280)

  // Save the PDF
  pdf.save(`phase-recovery-kit--${organisation}.pdf`)
}

export const copyRecoveryKit = async (
  mnemonic: string,
  email: string,
  organisation: string,
  name?: string
) => {
  const hostname = `${window.location.protocol}//${window.location.host}`

  const recoveryKit = `
  Phase Recovery Kit\n\n
  ${name ? `Name: ${name}` : ''}\n
  Email: ${email}\n
  Organsation: ${organisation}\n
  LoginUrl: ${hostname}\n
  Recovery phrase: ${mnemonic}\n
  Generated on ${new Date().toDateString()}
  `

  const copied = await copyToClipBoard(recoveryKit)
  copied ? toast.info('Copied to clipboard', { autoClose: 2000 }) : toast.error('Failed to copy')
}
