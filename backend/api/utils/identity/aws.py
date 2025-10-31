import botocore.loaders


def list_sts_endpoints():
    """
    Return a list of STS endpoints from botocore's endpoint metadata.

    Output: List[dict(regionCode, regionName, endpoint)]
    """
    loader = botocore.loaders.create_loader()
    endpoints_data = loader.load_data("endpoints")
    partitions = endpoints_data.get("partitions", [])
    results = []
    for part in partitions:
        services = part.get("services", {})
        if "sts" not in services:
            continue
        service = services["sts"]
        endpoints = service.get("endpoints", {})
        for region_code, meta in endpoints.items():
            hostname = meta.get("hostname")
            if not hostname:
                hostname = f"sts.{region_code}.{part.get('dnsSuffix', 'amazonaws.com')}"
            region_name = region_code
            results.append(
                {
                    "regionCode": region_code,
                    "regionName": region_name,
                    "endpoint": f"https://{hostname}",
                }
            )

    return results
