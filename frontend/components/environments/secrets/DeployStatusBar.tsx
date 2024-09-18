import React from 'react';
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
          <div className="relative">
            <DeployPreview
              clientSecrets={clientSecrets}
              serverSecrets={serverSecrets}
              secretsToDelete={secretsToDelete}
              onDiscard={onDiscard}
              isLoading={isLoading}
            />
          </div>
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
    </div>
  );
};

export default DeployStatusBar;
