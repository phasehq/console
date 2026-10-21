import certifi
import stripe


def test_stripe_uses_certifi_bundle():
    # stripe-python's bundled CA file still trusts the compromised emSign root.
    assert stripe.ca_bundle_path == certifi.where()
