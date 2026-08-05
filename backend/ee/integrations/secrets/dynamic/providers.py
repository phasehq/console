class DynamicSecretProviders:
    AWS = {
        "id": "aws",
        "name": "AWS IAM",
        "credentials": [
            {
                "id": "username",
                "type": "string",
                "default_key_name": "AWS_IAM_USERNAME",
                "masked": False,
            },
            {
                "id": "access_key_id",
                "type": "string",
                "default_key_name": "AWS_ACCESS_KEY_ID",
                "masked": False,
            },
            {
                "id": "secret_access_key",
                "type": "string",
                "default_key_name": "AWS_SECRET_ACCESS_KEY",
                "masked": True,
            },
        ],
        "config_map": [
            {
                "id": "username_template",
                "label": "IAM Username Template",
                "input_type": "string",
                "required": True,
                "default": "{{ random }}",
                "help_text": "A template for usernames created for each credential.",
            },
            {
                "id": "iam_path",
                "label": "AWS IAM Path",
                "input_type": "string",
                "required": False,
                "default": "/",
                "help_text": "Optional IAM user path. Defaults to '/'.",
            },
            {
                "id": "policy_arns",
                "label": "AWS Policy ARNs",
                "input_type": "list",
                "required": False,
                "help_text": "The specified policies will be attached to generated users.",
            },
            {
                "id": "groups",
                "label": "AWS IAM Groups",
                "input_type": "list",  # accept comma-separated or array
                "required": False,
                "help_text": "Generated users will be added to the specified IAM groups.",
            },
            {
                "id": "permission_boundary_arn",
                "label": "IAM User Permissions Boundary ARN",
                "input_type": "string",
                "required": False,
                "help_text": "The ARN of the AWS permissions boundary to attach to generated users.",
            },
        ],
    }

    @classmethod
    def get_service_choices(cls):
        return [
            (provider["id"], provider["name"])
            for provider in cls.__dict__.values()
            if isinstance(provider, dict)
        ]
