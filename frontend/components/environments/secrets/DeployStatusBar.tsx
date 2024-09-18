import React from 'react';
import { Button } from '@/components/common/Button';
import { FaCheckCircle } from 'react-icons/fa';
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
  envSyncs?: any;
}

const DeployStatusBar: React.FC<DeployStatusBarProps> = ({
  unsavedChanges,
  isLoading,
  onDiscard,
  onDeploy,
  clientSecrets,
  serverSecrets,
  secretsToDelete,
  envSyncs
}) => {
  return (
    <div className={clsx(
      "flex items-center gap-2",
      "transition-all duration-300 ease-in-out",
      unsavedChanges ? [
        "w-full",
        "rounded-full shadow-lg px-2.5 py-2.5",
        "bg-white dark:bg-neutral-800"
      ] : "w-full",
      "mr-6"
    )}>
      {unsavedChanges ? (
        <>
          <div className="flex-grow">
            <DeployPreview
              clientSecrets={clientSecrets}
              serverSecrets={serverSecrets}
              secretsToDelete={secretsToDelete}
              onDiscard={onDiscard}
              isLoading={isLoading}
            />
          </div>
          <Button
            variant={unsavedChanges ? 'warning' : 'primary'}
            onClick={onDeploy}
            disabled={isLoading}
            isLoading={isLoading}
            className="whitespace-nowrap"
          >
            {isLoading ? 'Deploying...' : 'Deploy changes'}
          </Button>
        </>
      ) : (
        <div className="flex items-center text-emerald-500 bg-emerald-500/10 px-4 py-2.5 rounded-full">
          {(!envSyncs || envSyncs.length === 0) && <FaCheckCircle className="mr-2" />}
          <span>Deployed</span>
        </div>
      )}
    </div>
  );
};

export default DeployStatusBar;
