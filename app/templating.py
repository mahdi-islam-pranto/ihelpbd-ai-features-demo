from fastapi.templating import Jinja2Templates

from app import config
from app.features import FEATURES, features_by_category

templates = Jinja2Templates(directory=str(config.APP_DIR / "templates"))
templates.env.globals.update(
    app_name=config.APP_NAME,
    company_name=config.COMPANY_NAME,
    features=FEATURES,
    features_by_category=features_by_category,
)
