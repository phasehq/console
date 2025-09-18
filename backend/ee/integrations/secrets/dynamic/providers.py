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
                "label": "IAM Username template",
                "input_type": "string",
                "required": True,
                "default": "{{ random }}",
                "help_text": "A template for usernames created per credential",
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
                "help_text": "Generated users will be attached to the specified policy ARNs.",
            },
            {
                "id": "groups",
                "label": "AWS IAM Groups",
                "input_type": "list",  # accept comma-separated or array
                "required": False,
                "help_text": "Generated users will be attached to the specified IAM groups.",
            },
            {
                "id": "permission_boundary_arn",
                "label": "IAM User Permission Boundary ARN",
                "input_type": "string",
                "required": False,
                "help_text": "ARN attached to the generated user for AWS Permission Boundary.",
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
