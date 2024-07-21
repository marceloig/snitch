from .views import AwsAccountView, AwsCloudtrailTrailEventView 
from django.urls import path  
  
urlpatterns = [  
    path('aws-account/', AwsAccountView.as_view()),
    path('trail/', AwsCloudtrailTrailEventView.as_view()) 
]  