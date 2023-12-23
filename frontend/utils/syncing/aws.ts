export type AwsRegion = {
  region: string
  regionName: string
}

export const awsRegions: AwsRegion[] = [
  { region: 'us-east-1', regionName: 'US East (N. Virginia)' },
  { region: 'us-east-2', regionName: 'US East (Ohio)' },
  { region: 'us-west-1', regionName: 'US West (N. California)' },
  { region: 'us-west-2', regionName: 'US West (Oregon)' },
  { region: 'af-south-1', regionName: 'Africa (Cape Town)' },
  { region: 'ap-east-1', regionName: 'Asia Pacific (Hong Kong)' },
  { region: 'ap-south-1', regionName: 'Asia Pacific (Mumbai)' },
  { region: 'ap-northeast-3', regionName: 'Asia Pacific (Osaka)' },
  { region: 'ap-northeast-2', regionName: 'Asia Pacific (Seoul)' },
  { region: 'ap-southeast-1', regionName: 'Asia Pacific (Singapore)' },
  { region: 'ap-southeast-2', regionName: 'Asia Pacific (Sydney)' },
  { region: 'ap-northeast-1', regionName: 'Asia Pacific (Tokyo)' },
  { region: 'ca-central-1', regionName: 'Canada (Central)' },
  { region: 'eu-central-1', regionName: 'Europe (Frankfurt)' },
  { region: 'eu-west-1', regionName: 'Europe (Ireland)' },
  { region: 'eu-west-2', regionName: 'Europe (London)' },
  { region: 'eu-south-1', regionName: 'Europe (Milan)' },
  { region: 'eu-west-3', regionName: 'Europe (Paris)' },
  { region: 'eu-north-1', regionName: 'Europe (Stockholm)' },
  { region: 'me-south-1', regionName: 'Middle East (Bahrain)' },
  { region: 'sa-east-1', regionName: 'South America (São Paulo)' },
  { region: 'cn-north-1', regionName: 'China (Beijing)' },
  { region: 'cn-northwest-1', regionName: 'China (Ningxia)' },
]
