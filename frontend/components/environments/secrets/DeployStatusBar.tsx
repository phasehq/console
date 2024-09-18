import React, { useState } from 'react';
import { Button } from '@/components/common/Button';
import { FaUndo, FaCheckCircle } from 'react-icons/fa';
import { DeployPreview } from '@/components/environments/secrets/DeployPreview';
import clsx from 'clsx';

interface DeployStatusBarProps {
  unsavedChanges: boolean;
  isLoading: boolean;
  onDiscard: () => void;
  onDeploy: () => void;
  clientSecrets: any[];
  serverSecrets: any[];
  secretsToDelete: string[];
}

const DeployStatusBar: React.FC<DeployStatusBarProps> = ({
  unsavedChanges,
  isLoading,
  onDiscard,
  onDeploy,
  clientSecrets,
  serverSecrets,
  secretsToDelete
}) => {
  const [showPreview, setShowPreview] = useState(false);

  const togglePreview = () => setShowPreview(!showPreview);

  return (
    <div className={clsx(
      "fixed bottom-4 right-4",
      "flex items-center gap-2 rounded-full shadow-lg px-4 py-3",
      "bg-white dark:bg-neutral-800",
      "transition-all duration-300 ease-in-out",
      unsavedChanges ? "h-14" : "h-12"
    )}>
      {unsavedChanges ? (
        <>
          <button
            onClick={togglePreview}
            className="text-sm text-gray-600 dark:text-gray-300 hover:underline focus:outline-none"
          >
            1 change to publish
          </button>
          <Button variant="text" onClick={onDiscard} disabled={isLoading}>
            <FaUndo className="mr-1" />
            Discard
          </Button>
          <Button
            variant="primary"
            onClick={onDeploy}
            disabled={isLoading}
            isLoading={isLoading}
            className="h-10"
          >
            {isLoading ? 'Deploying...' : 'Deploy changes'}
          </Button>
        </>
      ) : (
        <div className="flex items-center text-emerald-500">
          <FaCheckCircle className="mr-2" />
          <span>Deployed</span>
        </div>
      )}
      {showPreview && (
        <div className="absolute bottom-full left-0 mb-2 w-full">
      <DeployPreview
        clientSecrets={clientSecrets}
        serverSecrets={serverSecrets}
        secretsToDelete={secretsToDelete}
      />
        </div>
      )}
    </div>
  );
};

export default DeployStatusBar;
