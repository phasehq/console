// recovery.test.ts
import { generateRecoveryPdf, copyRecoveryKit } from '@/utils/recovery';
import jsPDF from 'jspdf';
import { toast } from 'react-toastify';
import { copyToClipBoard } from '@/utils/clipboard';

// Mocking jsPDF with necessary method stubs
jest.mock('jspdf', () => {
  return jest.fn().mockImplementation(() => ({
    setFillColor: jest.fn(),
    setTextColor: jest.fn(),
    setFontSize: jest.fn(),
    setFont: jest.fn(),
    rect: jest.fn(),
    text: jest.fn(),
    addImage: jest.fn(),
    save: jest.fn(),
    internal: { pageSize: { getWidth: jest.fn().mockReturnValue(210) } }, // Mock page width
    getImageProperties: jest.fn().mockReturnValue({ width: 100, height: 100 }), // Mock image properties
  }));
});
jest.mock('react-toastify', () => ({
  toast: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock('@/utils/clipboard', () => ({
  copyToClipBoard: jest.fn(),
}));

describe('Recovery Functions', () => {
  const mnemonic = 'sphere sheriff decline trouble type bundle match climb dumb current deliver large awesome deal dinner lens oven meat load zoo decide suffer escape phone';
  const email = 'satoshi@gmx.com';
  const organisation = 'BTCCORE';
  const name = 'Satoshi Nakemoto';

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  describe('generateRecoveryPdf', () => {
    it('should generate a PDF with all details', async () => {
      // Call the function
      await generateRecoveryPdf(mnemonic, email, organisation, name);

      // Assertions
      expect(jsPDF).toHaveBeenCalled();
      // Additional assertions can be added to check the content of the PDF
    });

    it('should generate a PDF without a name', async () => {
      // Call the function without a name
      await generateRecoveryPdf(mnemonic, email, organisation);

      // Assertions
      expect(jsPDF).toHaveBeenCalled();
      // Additional assertions can be added to check the absence of name in the PDF
    });
  });

  describe('copyRecoveryKit', () => {
    it('should copy the recovery kit to the clipboard', async () => {
      (copyToClipBoard as jest.Mock).mockResolvedValue(true);

      // Call the function
      await copyRecoveryKit(mnemonic, email, organisation, name);

      // Assertions
      expect(copyToClipBoard).toHaveBeenCalled();
      expect(toast.info).toHaveBeenCalledWith('Copied to clipboard', { autoClose: 2000 });
    });

    it('should show an error when copying fails', async () => {
      (copyToClipBoard as jest.Mock).mockResolvedValue(false);

      // Call the function
      await copyRecoveryKit(mnemonic, email, organisation, name);

      // Assertions
      expect(toast.error).toHaveBeenCalledWith('Failed to copy');
    });

  });

  describe('copyRecoveryKit', () => {
    it('should format the recovery kit with correct details', async () => {
      // Setup the clipboard mock to resolve successfully
      (copyToClipBoard as jest.Mock).mockResolvedValue(true);
  
      // Call the function
      await copyRecoveryKit(mnemonic, email, organisation, name);
  
      // Assertions
      const clipboardContent = (copyToClipBoard as jest.Mock).mock.calls[0][0];
      expect(clipboardContent).toContain(`Name: ${name}`);
      expect(clipboardContent).toContain(`Email: ${email}`);
      expect(clipboardContent).toContain(`Organsation: ${organisation}`);
      expect(clipboardContent).toContain(`LoginUrl: ${window.location.protocol}//${window.location.host}`);
      expect(clipboardContent).toContain(`Recovery phrase: ${mnemonic}`);
      expect(toast.info).toHaveBeenCalledWith('Copied to clipboard', { autoClose: 2000 });
    });
  });
  
});
