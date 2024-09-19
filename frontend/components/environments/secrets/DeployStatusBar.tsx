import React from 'react';
import { Button } from '@/components/common/Button';
import { FaCheckCircle } from 'react-icons/fa';
import { IoCloudUploadSharp } from "react-icons/io5";
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
  secretsToDelete,
}) => {
  return (
    <div className="mr-2 flex items-center gap-2">
      {unsavedChanges ? (
        <>
          <DeployPreview
            clientSecrets={clientSecrets}
            serverSecrets={serverSecrets}
            secretsToDelete={secretsToDelete}
            onDiscard={onDiscard}
            isLoading={isLoading}
          />
          <div
            onClick={onDeploy}
            className={clsx(
              "flex items-center gap-2",
              "rounded-full py-2 px-4",
              "text-amber-500 text-base",
              "ring-1 ring-inset ring-amber-500/20",
              "transition-all duration-300 ease-in-out",
              "cursor-pointer",
              { "opacity-50 cursor-not-allowed": isLoading }
            )}
          >
            <IoCloudUploadSharp className="shrink-0" />
            <span>{isLoading ? 'Deploying...' : 'Deploy changes'}</span>
          </div>
        </>
      ) : (
        <div className={clsx(
          "flex items-center gap-2",
          "rounded-full py-2 px-4",
          "text-emerald-500 text-base",
          "ring-1 ring-inset ring-emerald-500/20",
          "transition-all duration-300 ease-in-out",
        )}>
          <FaCheckCircle className="shrink-0" />
          <span>Deployed</span>
        </div>
      )}
    </div>
  );
};

export default DeployStatusBar;
