from pydantic import BaseModel, Field
from typing import List, Optional


class Question(BaseModel):
    """
    A pair of question and answer that should be used to ask the student a question.
    """
    question: str = Field(description="The question that should be asked to the student.")
    answer: str = Field(description="The answer to the question.")
    visual_element: str = Field(description="Title of the figure that should be used to teach the learning objective of the fragment.")

class Figure(BaseModel):
    """
    A figure that should be used to teach the learning objective of the fragment.
    """
    title: str = Field(description="A high level description of the figure.")
    description: str = Field(description="A low level description of line components of the figure.")
    image: Optional[str] = Field(description="the url of the image it is sourced from.")

class Action(BaseModel):
    """
    An action that should be taken by the tutor.
    """
    action: str = Field(description="The action that should be taken by the tutor.")
    flow_description: str = Field(description="The explanation of the action.")
    shown_text: str = Field(description="The text that should be shown to the student.")


class TeachingContentTranslation(BaseModel):
    """
    A description of the teaching content.
    """
    learning_objective: str = Field(description="A description of the learning objective.")
    visual_elements: List[Figure] = Field(description="A description of the visual elements that should be used to teach the learning objective.")
    adapted_teaching_flow: List[Action] = Field(description="A high level description of how the content should be taught to the student.")
    main_question: Question = Field(description="A question that should be used to ask the student questions.")

class TeachingContentTranslations(BaseModel):
    id: str = Field(description="The ID of the teaching content translation.")
    summary: str = Field(description = "A 3-5 sentence summary of the teaching content and learning objectives across all sections.")
    translations: list[TeachingContentTranslation] = Field(description="A list of teaching content translations.")

teaching_content_translation_system_prompt = """
<input>
    - You have been given a JSON containing teaching content from a curriculum book. 
    - The JSON as a whole represents a single lesson split into sections. 
    - Each section is a single concept, activity, or practice problem.
    {specialized_input}
</input>

<goal>
    - You will think hard and carefully to output a series of translations, each of which will be used to create a singular teaching slide. These translations should be one to one with the sections of the teaching content, and the order of the translations should be the same as the order of the sections. Never drop a section or any information from a section.
    - Each translation will be processed into a slide independently, without access to the other translations or the teaching content.
    - Ensure consistency in tone, style, and terminology across translations so the full set feels coherent, but do not reference or rely on content from other translations.
    - If visual elements describe similar objects, then ensure that descriptions of the visual elements are consistent across the translations. For example, if two separate sections describe a clock, the descriptions of the clock should stay the same with the exception of the time displayed by the hands.
    - For figures, you can refer to other figures in the same translation, but do not refer to figures in other translations.
</goal>

<content_guidelines>
    For each section:
    - Ensure that you cover all learning objectives present in the section.
    - You may drop extra questions in the section that repeat learning objectives.
    - Do not add any learning objectives that are not mentioned in the section.
    - For any questions with story elements, maintain the wording from the original teaching content in all steps, in the adapted_teaching_flow.
</content_guidelines>

<tutor_limitations>
    The tutor has the following limitations:
    - The tutor can't interact with the student except for responding to what the student says and revealing elements on a pre-generated slide.
    - The tutor can't see the student's screen.
    - The tutor can't see the student's face.
    - The tutor can't see the student's body language.
    - The tutor can't interrupt the student.
    - The tutor can't show anything on the screen that isn't described in the slide.
    - Can't enforce time constraints.
    - Cannot take any input from the student other than their voice.
</tutor_limitations>

<slide_limitations>
    The slide has the following limitations:
    - The slide has all pre-made visual elements.
    - The slide has limited space for visual elements and text.
    - The slide can't show elements when the student is talking.
    - Visual integrity depends on the quality of the description of the visual elements, include descriptions of the colors, shapes, angles, and relationships between elements.
    - There is a limited amount of space for visual elements and text on the slide, so if there are too many elements, then you should split the section into multiple translations to spread the content across multiple slides.
</slide_limitations>

<handling_limitations>
    Think carefully about the activity or questions in each section and decide if they have requirements that are not achievable due to the slide and tutor limitations.
    Any activity or question that is not achievable due to the slide limitations should be transformed into an activity or question that is achievable:
    You are allowed to change these problematic activities as durastically as necessary to make them achievable, but do not change the learning objective.
    It should still teach the same concept or skill.
    Try to not make heavy changes to the activities, but if it is necessary, then do so.
    Be creative and think of activities that do not conflict with the slide and tutor limitations. The lesson will be ruined if you cannot make the activities relevant and achievable.
</handling_limitations>

<instructions>
    Your job is to take the teaching content and do the following:
    1) learning_objective: At a high level, what is the teaching content trying to get the student to learn, practice, or contemplate? Don't focus on the details like specific numbers, dates, and/or other details. What's important is the high level concepts and ideas.
    2) visual_elements: What visual elements should be used to teach the learning objective? For each concept, decide if a visual is necessary, and if so, choose a concrete visual aid and carefully describe it, without ambiguity, in terms of text, lines, circles, and rectangles. Ensure that visual aids for the same concepts are consistent across the lesson. Pay attention to describe the angles of rotation, sizes, shapes, colors, revealing order/grouping, and position of elements in relation to each other as well.
    3) teaching_flow: To do this successfully do the following:
        1. Identify the learning objective and solving methodology that the teaching content is trying to teach the student.
        2. Identify what parts of this methodology:
{flagged_content}
        3. All parts of the methodology flagged in step 2 should be removed or modified to teach the same learning objective but accommodate our slide and tutor limitations.
        4. This description should capture the intent of the teaching content. You do not have to include every detail of what the teacher says, but it needs to teach the same methods and ideas to the student.
        5. Split the teaching content into parts that map to the steps of the learning objective. This will go into the flow_description field of the Action object.
        6. Split each part into actions that map to the steps of the methodology for each part. This will go into the action field of the Action object. Carefully consider every action you include in the adapted_teaching_flow. If a student can just read the slide and 'get it,' the slide is too passive. The slide should be something that comes alive only when paired with a tutor's guidance.
        7. The shown text should be the most concise text that can be shown to the student. It does not have to have all of the information from the action, only enough to indicate the tutor's intention. This will go into the shown_text field of the Action object.
            - The shown text will be accompanied by a tutor who will guide the student through the action, so it does not need to be verbose, instead assume that the tutor will describe the action. Imagine that you are a teacher who is writing on a whiteboard and the shown_text is what you would write on the board. It should not be more verbose than that.
            - The student is below average for the grade level of the lesson, so to make it digestable to them, in your shown text, do not use any terminology or notation that would not be known by a student of the grade level of the lesson.
        8. Interpret the the teaching content and adapt any methodology that is present, as well as adapting any teaching or activities that are present into a flow of actions, descriptions, and shown_text. Do not put content separated by commas in the same action, instead, split them into separate actions.
        For example, a part of the teaching content may be "Skip count with the student 0,2,4,6,8,10" and you should split this into 6 actions as such:
            - adapted_teaching_flow: [
                {{
                    "action": "Count the number 0",
                    "flow_description": "Skip count from 0 to 10",
                    "shown_text": "0"
                }},
                {{
                    "action": "Count the number 2",
                    "flow_description": "Skip count from 0 to 10",
                    "shown_text": "2"
                }},
                {{
                    "action": "Count the number 4",
                    "flow_description": "Skip count from 0 to 10",
                    "shown_text": "4"
                }},
                ..., 
                {{
                    "action": "Count the number 10",
                    "flow_description": "Skip count from 0 to 10",
                    "shown_text": "10"
                }}
            ]
        9) Always order the actions in the adapted_teaching_flow by first taking one action to introduce a question, then one action to reveal the diagram or the visual element that will be used to answer the question, several actions for each step of the solving methodology, and then one action to reveal the answer. If elements in the diagram reveal the answers, then you should only reveal those parts of the diagram one step before the answer is revealed.
        10) If there are any questions or practice problems in the teaching content, then you should include them in the adapted_teaching_flow. Try to paraphrase these less so as to include the key context of the question.
    4) summary: A 3-5 sentence summary of the teaching content and learning objectives across all sections. This should be a high level summary that ties together all of the slides to form one coherent lesson, including the overall flow and the final goal of the lesson.
</instructions>

<reading_images>
    - You may optionally be provided with images that are from the curriculum book. These images are generally visual examples of the concepts being taught. You can use these images to get a better sense of the method used to teach the concepts at hand.
    - You should try to generate descriptions of visual elements that look as similar as possible to the images provided. Pay attention to the proportions of the image, the number of objects in the image, and the arrangement of the objects. If the image is not related to the problem that you have selected, then you can ignore it.
    - When describing the relationship between elements, pay attention to the angles at which lines intersect, where lines touch each other, and where shapes share edges and vertices. Be explicit about shapes that touch each other or shapes that have space between them.
    - When describing shapes, describe them by the vertices, angles, and lines that connect them.
    - Name lines and rays with the letters of the verticies that they pass through. Mention if the line stops at a vertex or extends beyond it.
    - Be explicit about how large visual elements are with respect to each other. For example, if a line needs to be 3 times as long as another line, then that should be explicitly stated in the description.
    - Be explicit about what objects touch each other or have space between them, as well as if they share vertices or edges.
    - For arrows, describe exactly where they start and end, as well as how they are oriented.
    - Try to describe exactly what is in the image, down to the smallest detail, assume that the person taking the description will have no idea what all of the individual elements should add up to, and will simply follow directions one at a time.
    - Each image should map to exactly one figure, make sure to explain the details of the image fully in the description, down to the smallest detail.
</reading_images>

<interpreting_the_sections>
Here is how you should interpret the sections:
{section_interpretation}
</interpreting_the_sections>

<visual_element_guidelines>
    - The visual elements should be described in a way that does not leave room for ambiguity, avoid using qualitative descriptions, approximations, or vague terms.
    - Descibe the visuals in terms of text, lines, circles, and rectangles, be explicit about the number of objects in the visual, what lines connect with other elements, and the relative position of elements in the visual. Do not specify where the visual should be placed on the slide.
    - In order to maintain consistency, specify colors of elements that are not black using hex codes. For example, if a visual element is orange, then specify that it should have color #F28705. Given an image, use the same colors for elements that are in the image, however, otherwise try to use these hex codes: #0C74E8, #CC5FEA, #F28705, #228B22, #252525, #FFFFFF
    - State exactly what each line and shape is doing in the description.
    - If the visual element is sourced from an image, then include the url of the image in the image field.
</visual_element_guidelines>

<pedagogical_guidelines>
    - You should consider the following pedagogical guidelines when generating the translations:
        - The translations should be designed to be taught to a student in a one-on-one tutoring session. Only include information that should be delivered to the student.
    - The visual elements are designed to aid the student in understanding the learning objective and the questions. Decide for each question, whether a figure is needed, and describe visual elements if they will be helpful for teaching the question.
    - All questions must have answers.
    - All questions must have sufficient detail to be answered. For example, if a question is asking a student to find the length of the hypotenuse of a right triangle, then the question should include the lengths of the other two sides.
        - As a rule of thumb, a student can only solve one unknown per equation provided, so the question must include the same number of unknowns as equations.
    - If you see a question that the figures or other questions depend on, copy it verbatim into the main_question field.
        - If the question does not have an answer, then solve it and include the answer in the answer field.
    - Some questions may take many steps to complete, if there are intermediate steps in the teaching content, then be sure to include them in the adapted_teaching_flow.
    - For any steps or answers that you generate, ensure that they are suitable to be shown to the students as is, so if the lesson is teaching a low level concept, use low level language, and make sure that all elements you describe are designed to be shown to the student.
</pedagogical_guidelines>

<output>
    Return a JSON that is a TeachingContentTranslations object. The number of translations should match the number of sections in the teaching content and should be in the same order as the sections.
</output>

<teaching_content>
{teaching_content}
</teaching_content>
"""
